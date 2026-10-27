import { db } from '../db/index.js';
import { ApiError } from '../utils/response.js';
import { decrypt, encrypt, maskApiKey } from './crypto.js';

/**
 * 模型配置服务（v2）：OpenAI 单一配置，单行存储
 * - 管理端视图 api_key 脱敏、image_model 保留原始 null（UI 用 placeholder 表达默认）
 * - 调用端视图 image_model 已应用回退，永不为空
 * - 不缓存上游模型列表（每次拉取都真实请求上游）
 */

/** 生图模型默认值：配置为空时回退 */
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

/** 推理强度取值（与 OpenAI reasoning.effort 对齐，不含 minimal/none） */
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** 推理强度默认值 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** 单个字段最大长度（模型名/地址属短文本） */
const FIELD_MAX_LENGTH = 200;

/** 上游模型列表请求超时 */
const MODELS_FETCH_TIMEOUT_MS = 10_000;

/** 管理端视图（api_key 已脱敏） */
export interface ModelConfigView {
  provider: 'openai';
  base_url: string | null;
  api_key: string | null;
  default_model: string | null;
  /** 原始值：null 表示跟随系统默认（DEFAULT_IMAGE_MODEL） */
  image_model: string | null;
  reasoning_effort: ReasoningEffort;
  updated_at: string | null;
}

/** 调用端视图（image_model 已回退，永不为空） */
export interface ResolvedModelConfig {
  base_url: string | null;
  api_key: string | null;
  default_model: string | null;
  image_model: string;
  /** 是否由用户显式配置（false 表示使用系统默认） */
  image_model_configured: boolean;
  reasoning_effort: ReasoningEffort;
}

/** 上游模型条目 */
export type UpstreamModelKind = 'chat' | 'image' | 'other';
export interface UpstreamModel {
  id: string;
  kind: UpstreamModelKind;
}

interface ModelConfigRow {
  base_url: string | null;
  api_key: string | null;
  default_model: string | null;
  image_model: string | null;
  reasoning_effort: string | null;
  updated_at: string | null;
}

/** 读取唯一配置行（不存在返回 undefined） */
function readRow(): ModelConfigRow | undefined {
  return db
    .prepare(
      'SELECT base_url, api_key, default_model, image_model, reasoning_effort, updated_at FROM model_config WHERE id = 1',
    )
    .get() as ModelConfigRow | undefined;
}

/** 归一推理强度：空值或历史脏值都回落到默认档（容错，不抛错） */
function normalizeEffort(raw: string | null | undefined): ReasoningEffort {
  return isReasoningEffort(raw) ? raw : DEFAULT_REASONING_EFFORT;
}

/** 管理端视图：api_key 脱敏；密文损坏时降级为打码占位 */
export function getModelConfig(): ModelConfigView {
  const row = readRow();
  let maskedKey: string | null = null;
  if (row?.api_key) {
    try {
      maskedKey = maskApiKey(decrypt(row.api_key));
    } catch {
      maskedKey = '****';
    }
  }
  return {
    provider: 'openai',
    base_url: row?.base_url ?? null,
    api_key: maskedKey,
    default_model: row?.default_model ?? null,
    image_model: row?.image_model ?? null,
    reasoning_effort: normalizeEffort(row?.reasoning_effort),
    updated_at: row?.updated_at ?? null,
  };
}

/** 调用端视图：解密 api_key，image_model 应用默认回退 */
export function getResolvedConfig(): ResolvedModelConfig {
  const row = readRow();
  let apiKey: string | null = null;
  if (row?.api_key) {
    try {
      apiKey = decrypt(row.api_key);
    } catch {
      apiKey = null;
    }
  }
  const configuredImageModel = row?.image_model?.trim() ?? '';
  return {
    base_url: row?.base_url ?? null,
    api_key: apiKey,
    default_model: row?.default_model ?? null,
    image_model: configuredImageModel || DEFAULT_IMAGE_MODEL,
    image_model_configured: Boolean(configuredImageModel),
    reasoning_effort: normalizeEffort(row?.reasoning_effort),
  };
}

/** PUT 请求体：各字段均可选，未提供的字段保持不变 */
export interface SaveModelConfigInput {
  base_url?: string | null;
  api_key?: string | null;
  default_model?: string | null;
  image_model?: string | null;
  reasoning_effort?: ReasoningEffort;
}

/** 校验并归一字符串字段：非字符串抛 400，空串归一为 null */
export function normalizeOptionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'BAD_REQUEST', `${field} 必须为字符串或 null`);
  }
  const trimmed = value.trim();
  if (trimmed.length > FIELD_MAX_LENGTH) {
    throw new ApiError(400, 'BAD_REQUEST', `${field} 过长（最多 ${FIELD_MAX_LENGTH} 字符）`);
  }
  return trimmed || null;
}

/**
 * 保存配置（单行 upsert）
 * api_key 仅在请求体显式提供时更新：传非空字符串则加密落盘，传 null/空串则清空
 */
export function saveModelConfig(input: SaveModelConfigInput): ModelConfigView {
  const existing = readRow();
  const now = new Date().toISOString();

  const baseUrl = input.base_url !== undefined ? input.base_url : existing?.base_url ?? null;
  const defaultModel =
    input.default_model !== undefined ? input.default_model : existing?.default_model ?? null;
  const imageModel =
    input.image_model !== undefined ? input.image_model : existing?.image_model ?? null;
  const effort =
    input.reasoning_effort !== undefined
      ? input.reasoning_effort
      : normalizeEffort(existing?.reasoning_effort);

  let apiKeyCipher: string | null;
  if ('api_key' in input) {
    apiKeyCipher = input.api_key ? encrypt(input.api_key) : null;
  } else {
    apiKeyCipher = existing?.api_key ?? null;
  }

  db.prepare(
    `INSERT INTO model_config
       (id, provider, base_url, api_key, default_model, image_model, reasoning_effort, updated_at)
     VALUES (1, 'openai', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       base_url = excluded.base_url,
       api_key = excluded.api_key,
       default_model = excluded.default_model,
       image_model = excluded.image_model,
       reasoning_effort = excluded.reasoning_effort,
       updated_at = excluded.updated_at`,
  ).run(baseUrl, apiKeyCipher, defaultModel, imageModel, effort, now);

  return getModelConfig();
}

// ---- 上游模型列表 ----

/** 拼接 /models 地址（兼容 base_url 带 /v1、已带 /models、误带 /chat/completions） */
export function buildModelsEndpoint(baseUrl: string): string {
  let trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) {
    trimmed = trimmed.replace(/\/chat\/completions$/i, '');
  }
  if (/\/responses$/i.test(trimmed)) {
    trimmed = trimmed.replace(/\/responses$/i, '');
  }
  if (/\/models$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
}

/** 噪声模型：非对话/非图像生成，不进候选列表 */
const NOISE_MODEL_RE =
  /(embedding|embed-|tts|whisper|moderation|audio|realtime|transcribe|davinci|babbage|curie|codex)/i;
/** 对话类模型 */
const CHAT_MODEL_RE = /^(?:gpt-|chatgpt-|o[1-9])/i;
/** 图像生成类模型 */
const IMAGE_MODEL_RE = /(gpt-image|dall-e|image)/i;

/** 归类模型用途，供前端分区展示（生图模型字段优先展示 image 类） */
export function classifyModel(id: string): UpstreamModelKind {
  if (IMAGE_MODEL_RE.test(id)) return 'image';
  if (CHAT_MODEL_RE.test(id)) return 'chat';
  return 'other';
}

/** 是否保留该模型：先剔噪声，再只留对话/图像类 */
export function isUsefulModel(id: string): boolean {
  if (!id || NOISE_MODEL_RE.test(id)) return false;
  return CHAT_MODEL_RE.test(id) || IMAGE_MODEL_RE.test(id);
}

/** 脱敏上游错误片段（截断 + 去 base64/长串），避免把大段报文回给前端 */
function sanitizeDetail(text: string): string {
  return text
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image-data]')
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '[redacted]')
    .slice(0, 200);
}

/** 上游模型列表原始响应结构（只关心 id） */
interface ModelsResponseBody {
  data?: unknown;
}

/** 上游绝对地址校验：仅允许 http(s) */
export function assertHttpUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ApiError(400, 'INVALID_BASE_URL', 'Base URL 必须以 http:// 或 https:// 开头');
  }
  return trimmed;
}

/**
 * 拉取并解析上游模型列表
 * - 缺 base_url/api_key → MODEL_NOT_CONFIGURED
 * - 401/403 → UPSTREAM_AUTH_FAILED；不可达 → UPSTREAM_UNAVAILABLE；超时 → UPSTREAM_TIMEOUT
 * - 结构异常 → MODEL_LIST_INVALID
 * - 结果不落库、不缓存（D5）
 */
export async function fetchUpstreamModels(): Promise<{
  models: UpstreamModel[];
  total: number;
  fetched_at: string;
}> {
  const config = getResolvedConfig();
  if (!config.base_url || !config.api_key) {
    throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务尚未配置，请先保存 Base URL 与 API Key');
  }

  const endpoint = buildModelsEndpoint(config.base_url);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.api_key}` },
      signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ApiError(504, 'UPSTREAM_TIMEOUT', '拉取模型列表超时，请检查 Base URL 或稍后重试');
    }
    console.error('[model-config] 拉取模型列表失败:', err instanceof Error ? err.message : err);
    throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', '无法连接模型服务，请检查 Base URL 与网络');
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = sanitizeDetail(await response.text());
    } catch {
      // 上游错误体不可读时忽略
    }
    const suffix = detail ? `：${detail}` : '';
    console.error(`[model-config] 模型列表返回 HTTP ${response.status}${suffix}`);
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(502, 'UPSTREAM_AUTH_FAILED', `模型服务鉴权失败，请检查 API Key${suffix}`);
    }
    if (response.status === 429) {
      throw new ApiError(429, 'UPSTREAM_RATE_LIMITED', `模型服务限流，请稍后重试${suffix}`);
    }
    throw new ApiError(502, 'UPSTREAM_ERROR', `模型服务返回错误（HTTP ${response.status}）${suffix}`);
  }

  let body: ModelsResponseBody;
  try {
    body = (await response.json()) as ModelsResponseBody;
  } catch {
    throw new ApiError(502, 'MODEL_LIST_INVALID', '模型服务返回了无法解析的响应');
  }
  if (!Array.isArray(body.data)) {
    throw new ApiError(502, 'MODEL_LIST_INVALID', '模型列表结构不正确（缺少 data 数组）');
  }

  const seen = new Set<string>();
  const models: UpstreamModel[] = [];
  for (const item of body.data) {
    if (typeof item !== 'object' || item === null) continue;
    const rawId = (item as { id?: unknown }).id;
    if (typeof rawId !== 'string') continue;
    const id = rawId.trim();
    if (!isUsefulModel(id) || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, kind: classifyModel(id) });
  }
  // image 在前，便于生图模型字段直接选；同 kind 按字母序
  const kindOrder: Record<UpstreamModelKind, number> = { image: 0, chat: 1, other: 2 };
  models.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id));

  return { models, total: models.length, fetched_at: new Date().toISOString() };
}
