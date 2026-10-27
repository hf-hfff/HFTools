import { ApiError } from '../utils/response.js';

/**
 * Responses API 图片生成客户端（adapter）：
 * - 拼接 endpoint、构造 image_generation 流式请求体（POST /v1/responses）
 * - 解析上游 SSE 事件流，错误事件脱敏后归类为 ApiError
 * - 从事件 JSON 提取图片结果（内联 data URL 或远程 URL），远程 URL 限长下载为 data URL
 * 安全约定：前端零密钥，api_key / 用户 prompt 仅存在于后端，错误详情经 sanitizeDetail 脱敏后透出
 */

/** 图片生成请求入参（baseUrl/apiKey 来自管理平台已解密的模型配置） */
export interface ResponsesImageInput {
  baseUrl: string;
  apiKey: string;
  /** 驱动 Responses 的主模型（配置中的默认模型） */
  model: string;
  /** 实际出图的模型，写入 tools[0].model；调用方保证已回退默认值，永不为空 */
  imageModel: string;
  image: string;
  prompt: string;
  timeoutMs?: number;
}

/** 依赖注入（fetch 可注入，便于测试与统一超时控制） */
export interface ResponsesImageDeps {
  fetch?: typeof fetch;
}

/** SSE 事件（event/data 字段） */
export interface ResponsesSseEvent {
  event: string;
  data: string;
}

/** 提取结果：内联 base64 data URL，或需二次下载的远程 URL */
export type ExtractedImage = { kind: 'dataUrl'; dataUrl: string } | { kind: 'url'; url: string };

/** 请求默认超时（与 AbortController 配合，覆盖请求→SSE→图片下载全程） */
const DEFAULT_TIMEOUT_MS = 120_000;

/** 图片下载字节上限（32MB，含 base64 膨胀余量），超限拒绝，防止异常大响应撑爆内存 */
const MAX_IMAGE_DOWNLOAD_BYTES = 32 * 1024 * 1024;

/** SSE 解析缓冲区软上限（64MB），防止上游异常持续输出耗尽内存 */
const MAX_SSE_BUFFER_BYTES = 64 * 1024 * 1024;

/** 上游错误响应体读取上限（错误体仅用于归类与截断展示，无需全量读入） */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

const VERBATIM_INSTRUCTIONS =
  'You must call the image_generation tool exactly once, using the user message as the prompt. ' +
  'Pass the user prompt to the image_generation tool VERBATIM: do not rewrite, expand, shorten, ' +
  'rephrase, translate, add extra text, or otherwise polish it.';

const IMAGE_KEY_RE = /image|b64|base64|picture|photo/i;
/**
 * 遍历提取时跳过的子树：input 是请求回显（含用户原图与提示词，非生成结果），
 * instructions 是系统指令文本；二者会被上游原样带回，不跳过会误命中输入图/长文本
 */
const SKIPPED_SUBTREE_KEYS = new Set(['input', 'instructions']);
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URL_RE = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]*)$/i;
const HTTP_URL_RE = /^https?:\/\//i;
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i;

// 错误归类正则：HTTP 状态码数字加 \b 词边界，避免命中长数字子串（如 40400 中的 404）
const P_IMAGE_TOOL = /(image[_\s-]*(?:generation|gen)\b|image tool|img tool)/;
const P_NOT_SUPPORTED =
  /(not\s+(?:supported|available|recognized|found|allowed)|unsupported|unrecognized|unknown|does\s+not\s+support|no\s+such|invalid\s+(?:tool|type|value)|\b404\b)/;
const P_RESPONSES = /(responses?\s+api|\/responses\b)/;
const P_RATE_LIMIT = /(rate[\s_-]?limit|too\s+many\s+requests|quota|\b429\b)/;
const P_TIMEOUT = /(timed?\s*out|timeout|deadline|gateway\s+time-?out|\b504\b)/;
const P_AUTH = /(api[\s_-]?key|unauthorized|authentication|invalid[_\s-]?auth|permission\s+denied|forbidden|\b401\b|\b403\b)/;
const P_NETWORK = /(fetch failed|terminated|network|socket|econn|enotfound|epipe|other side closed)/;

const ALLOWED_DOWNLOAD_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

// ---- endpoint / 请求体构造 ----

/** 拼接 Responses API 完整地址（兼容 base_url 带不带 /v1、已带 /responses、结尾斜杠） */
export function buildResponsesEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/responses$/.test(trimmed)) return trimmed;
  if (/\/v1$/.test(trimmed)) return `${trimmed}/responses`;
  return `${trimmed}/v1/responses`;
}

/**
 * 构造 image_generation 流式请求体
 * 生图模型写在工具定义内（tools[0].model），不使用非标准的顶层 image_model 字段
 */
export function buildResponsesRequestBody(input: ResponsesImageInput): Record<string, unknown> {
  return {
    model: input.model,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_image', image_url: input.image },
          { type: 'input_text', text: input.prompt },
        ],
      },
    ],
    instructions: VERBATIM_INSTRUCTIONS,
    tools: [{ type: 'image_generation', model: input.imageModel }],
    stream: true,
  };
}

// ---- 脱敏与错误归类 ----

/** 错误详情脱敏：替换 secrets、base64 图片数据后截断 300 字符，防止 key/提示词/大块图片数据外泄 */
function sanitizeDetail(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  out = out.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image-data]');
  out = out.replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '[redacted]');
  return out.slice(0, 300);
}

/** 按错误文本特征归类为语义化 ApiError（不支持工具/限流/超时/鉴权，其余兜底 IMAGE_GENERATION_FAILED） */
function classifyUpstreamText(text: string, secrets: string[] = []): ApiError {
  const detail = sanitizeDetail(text, secrets);
  const suffix = detail ? `：${detail}` : '';
  const lower = text.toLowerCase();
  if (P_IMAGE_TOOL.test(lower) && P_NOT_SUPPORTED.test(lower)) {
    return new ApiError(502, 'IMAGE_TOOL_NOT_SUPPORTED', `模型服务不支持 image_generation 图片工具，请检查模型或服务配置${suffix}`);
  }
  if (P_RESPONSES.test(lower) && P_NOT_SUPPORTED.test(lower)) {
    return new ApiError(502, 'RESPONSES_NOT_SUPPORTED', `模型服务不支持 Responses API，请检查 base_url 对应服务${suffix}`);
  }
  if (P_RATE_LIMIT.test(lower)) {
    return new ApiError(429, 'UPSTREAM_RATE_LIMITED', `模型服务限流，请稍后重试${suffix}`);
  }
  if (P_TIMEOUT.test(lower)) {
    return new ApiError(504, 'UPSTREAM_TIMEOUT', `模型服务响应超时，请稍后重试${suffix}`);
  }
  if (P_AUTH.test(lower)) {
    return new ApiError(502, 'UPSTREAM_AUTH_FAILED', `模型服务鉴权失败，请检查 api_key 是否有效${suffix}`);
  }
  return new ApiError(502, 'IMAGE_GENERATION_FAILED', `图片生成失败${suffix}`);
}

/** 按 HTTP 状态码抛出语义化 ApiError（400 再走文本细分类），日志落脱敏后的上游详情 */
export function throwForHttpStatus(status: number, bodyText: string, secrets: string[]): never {
  const detail = sanitizeDetail(bodyText, secrets);
  const suffix = detail ? `：${detail}` : '';
  console.error(`[responses-image] 模型服务返回 HTTP ${status}${suffix}`);
  if (status === 401 || status === 403) {
    throw new ApiError(502, 'UPSTREAM_AUTH_FAILED', `模型服务鉴权失败，请检查 api_key 是否有效${suffix}`);
  }
  if (status === 429) {
    throw new ApiError(429, 'UPSTREAM_RATE_LIMITED', `模型服务限流，请稍后重试${suffix}`);
  }
  if (status === 408 || status === 504) {
    throw new ApiError(504, 'UPSTREAM_TIMEOUT', `模型服务响应超时，请稍后重试${suffix}`);
  }
  if (status === 400) {
    const classified = classifyUpstreamText(bodyText, secrets);
    if (classified.code === 'IMAGE_TOOL_NOT_SUPPORTED' || classified.code === 'RESPONSES_NOT_SUPPORTED') {
      throw classified;
    }
    throw new ApiError(502, 'IMAGE_GENERATION_FAILED', `图片生成请求被模型服务拒绝（HTTP 400）${suffix}`);
  }
  throw new ApiError(502, 'IMAGE_GENERATION_FAILED', `模型服务返回错误（HTTP ${status}）${suffix}`);
}

/**
 * 限长读取上游响应体文本（上限 MAX_ERROR_BODY_BYTES）：两处错误响应体读取点共用，
 * content-length 缺失或谎报时按实际累计字节截断，防止异常大错误体撑爆内存
 */
async function readBodyTextCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (total >= MAX_ERROR_BODY_BYTES) break;
    }
    out += decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } catch {
      void 0;
    }
  }
  return out;
}

// ---- SSE 解析 ----

/** 解析单个 SSE 事件块（event/data 字段，忽略注释行），无 data 返回 null */
function parseSseBlock(block: string): ResponsesSseEvent | null {
  let event = '';
  const dataParts: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataParts.push(value);
  }
  if (dataParts.length === 0) return null;
  return { event, data: dataParts.join('\n') };
}

/** 从事件 JSON 中提取上游错误信息（error 字段或 response.error.message） */
function findErrorMessage(json: Record<string, unknown> | null): string | null {
  if (!json) return null;
  const candidates: unknown[] = [json.error];
  const response = json.response;
  if (typeof response === 'object' && response !== null) {
    candidates.push((response as Record<string, unknown>).error);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (typeof candidate === 'object' && candidate !== null) {
      const message = (candidate as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  return null;
}

/** 判定事件：错误类事件脱敏归类后直接抛 ApiError；终态（response.completed）返回 true，否则 false */
function classifySseEvent(evt: ResponsesSseEvent, secrets: string[]): boolean {
  const trimmed = evt.data.trim();
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    json = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  const type = typeof json?.type === 'string' ? json.type : '';

  if (evt.event === 'error' || type === 'error') {
    const message =
      findErrorMessage(json) ??
      (json && typeof json.message === 'string' && json.message.trim() ? json.message : trimmed);
    console.error(`[responses-image] 上游返回错误事件：${sanitizeDetail(message, secrets)}`);
    throw classifyUpstreamText(message, secrets);
  }

  const found = findErrorMessage(json);
  if (found) {
    console.error(`[responses-image] 上游返回错误事件：${sanitizeDetail(found, secrets)}`);
    throw classifyUpstreamText(found, secrets);
  }

  if (evt.event === 'response.failed' || type === 'response.failed') {
    const message =
      json && typeof json.message === 'string' && json.message.trim() ? json.message : trimmed;
    console.error(`[responses-image] 上游返回错误事件：${sanitizeDetail(message, secrets)}`);
    throw classifyUpstreamText(message, secrets);
  }

  return evt.event === 'response.completed' || type === 'response.completed';
}

/**
 * 将上游 SSE 流解析为事件序列：遇到 [DONE]、response.completed 终态或错误事件即结束
 * 缓冲区超软上限（MAX_SSE_BUFFER_BYTES）抛 IMAGE_GENERATION_FAILED，经主函数 normalize 脱敏透出
 * @param secrets 错误详情脱敏用（api_key、用户 prompt，见主函数）
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  secrets: string[] = [],
): AsyncGenerator<ResponsesSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      // 缓冲区软上限：无事件分隔符的异常流会让 buffer 无限累积，超限即中止防止内存耗尽
      if (buffer.length > MAX_SSE_BUFFER_BYTES) {
        throw new ApiError(
          502,
          'IMAGE_GENERATION_FAILED',
          `SSE 响应缓冲超过大小上限（${Math.floor(MAX_SSE_BUFFER_BYTES / 1024 / 1024)}MB），已中止解析`,
        );
      }
      for (;;) {
        const separator = /\r?\n\r?\n/.exec(buffer);
        if (!separator) break;
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const event = parseSseBlock(block);
        if (!event) continue;
        if (event.data.trim() === '[DONE]') return;
        const terminal = classifySseEvent(event, secrets);
        // 终态事件必须先 yield 给调用方（图片结果就在 response.completed 里），再结束迭代；
        // 若先 return 会丢掉终态事件，调用方提取不到结果
        yield event;
        if (terminal) return;
      }
    }
    buffer += decoder.decode();
    const event = parseSseBlock(buffer);
    if (!event) return;
    if (event.data.trim() === '[DONE]') return;
    const terminal = classifySseEvent(event, secrets);
    yield event;
    if (terminal) return;
  } finally {
    try {
      await reader.cancel();
    } catch {
      void 0;
    }
  }
}

// ---- 图片提取 ----

/** 按魔数识别图片 mime（jpeg/png/webp），无法识别返回 null */
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * 校验 base64 图片载荷（去空白 → base64 合法 → 非空 → 魔数识别 mime）
 * 统一容错语义：任何非法载荷返回 null（调用方跳过该候选继续找下一个），不抛错；
 * 「所有候选均校验失败」的 IMAGE_DECODE_FAILED 由主函数在最终无结果时统一抛出
 */
function validateImagePayload(payload: string): { mime: string; base64: string } | null {
  const clean = payload.replace(/\s+/g, '');
  if (!clean) return null;
  if (!BASE64_RE.test(clean)) return null;
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0) return null;
  const mime = detectImageMime(buf);
  if (!mime) return null;
  return { mime, base64: clean };
}

/** 深度优先遍历事件 JSON，产出带「图片上下文」标记的字符串候选（见 SKIPPED_SUBTREE_KEYS 跳过规则） */
function* walkImageStrings(
  value: unknown,
  inheritedImageContext: boolean,
  key: string | null,
): Generator<{ text: string; imageContext: boolean }> {
  const imageContext = inheritedImageContext || (key !== null && IMAGE_KEY_RE.test(key));
  if (typeof value === 'string') {
    yield { text: value, imageContext };
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* walkImageStrings(item, imageContext, null);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const typeContext = typeof record.type === 'string' && IMAGE_KEY_RE.test(record.type);
    const childContext = imageContext || typeContext;
    for (const [childKey, childValue] of Object.entries(record)) {
      if (SKIPPED_SUBTREE_KEYS.has(childKey)) continue;
      yield* walkImageStrings(childValue, childContext, childKey);
    }
  }
}

/** 单事件提取结果：图片候选 + 是否出现过校验失败的候选（供主函数判定解码失败） */
type ImageExtractAttempt = { image: ExtractedImage | null; sawInvalidCandidate: boolean };

/**
 * 从单个 SSE 事件 JSON 中提取图片（容错，不因损坏载荷中止整个提取）：
 * - data URL 分支受 imageContext 门控，无图片上下文的裸 data URL 字符串不纳入候选
 * - 候选校验失败仅标记 sawInvalidCandidate 并跳过，继续在本事件内找下一个候选
 */
function attemptExtractImage(evt: ResponsesSseEvent): ImageExtractAttempt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(evt.data);
  } catch {
    return { image: null, sawInvalidCandidate: false };
  }
  const eventNameContext = IMAGE_KEY_RE.test(evt.event);
  let sawInvalidCandidate = false;
  for (const { text, imageContext } of walkImageStrings(parsed, eventNameContext, null)) {
    const dataUrlMatch = DATA_URL_RE.exec(text);
    if (dataUrlMatch) {
      if (!imageContext) continue;
      const subtype = dataUrlMatch[1].toLowerCase();
      const normalized = subtype === 'jpg' ? 'jpeg' : subtype;
      if (normalized !== 'jpeg' && normalized !== 'png' && normalized !== 'webp') {
        throw new ApiError(502, 'UPSTREAM_INVALID_IMAGE', '模型服务返回的图片格式不受支持（仅 jpeg/png/webp）');
      }
      if (!validateImagePayload(dataUrlMatch[2])) {
        sawInvalidCandidate = true;
        continue;
      }
      return { image: { kind: 'dataUrl', dataUrl: text }, sawInvalidCandidate };
    }
    if (HTTP_URL_RE.test(text) && (imageContext || IMAGE_EXT_RE.test(text))) {
      return { image: { kind: 'url', url: text }, sawInvalidCandidate };
    }
    if (imageContext && text.length >= 32 && BASE64_RE.test(text)) {
      const validated = validateImagePayload(text);
      if (!validated) {
        sawInvalidCandidate = true;
        continue;
      }
      return {
        image: { kind: 'dataUrl', dataUrl: `data:image/${validated.mime};base64,${validated.base64}` },
        sawInvalidCandidate,
      };
    }
  }
  return { image: null, sawInvalidCandidate };
}

/** 从单个 SSE 事件中提取图片结果；事件不可解析或无图片候选返回 null（容错，不抛错） */
export function extractImageFromEvent(evt: ResponsesSseEvent): ExtractedImage | null {
  return attemptExtractImage(evt).image;
}

// ---- URL 下载 ----

/**
 * 按累计字节上限限长读取响应体为 Buffer，超限抛 IMAGE_GENERATION_FAILED 并中止读取
 * （读取全程受请求 signal 约束，超时同样覆盖下载阶段）
 */
async function readBodyBytesCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const body = response.body;
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ApiError(
          502,
          'IMAGE_GENERATION_FAILED',
          `结果图超过大小上限（${Math.floor(maxBytes / 1024 / 1024)}MB），已中止读取`,
        );
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      void 0;
    }
  }
  return Buffer.concat(chunks);
}

/**
 * 下载远程结果图为 base64 data URL：
 * content-length 预检 + 读取期累计字节双重上限（超限抛 IMAGE_GENERATION_FAILED），
 * MIME 白名单与魔数双重校验，错误体经 readBodyTextCapped 限长读取
 */
export async function downloadImageAsDataUrl(
  url: string,
  doFetch: typeof fetch,
  signal: AbortSignal,
  secrets: string[],
): Promise<string> {
  const response = await doFetch(url, { signal });
  if (!response.ok) {
    let body = '';
    try {
      body = await readBodyTextCapped(response);
    } catch {
      void 0;
    }
    throwForHttpStatus(response.status, body, secrets);
  }
  // content-length 预检：声明超限直接拒绝，省去无谓的 body 读取
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_DOWNLOAD_BYTES) {
    throw new ApiError(
      502,
      'IMAGE_GENERATION_FAILED',
      `结果图超过大小上限（${Math.floor(MAX_IMAGE_DOWNLOAD_BYTES / 1024 / 1024)}MB），已中止下载`,
    );
  }
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_DOWNLOAD_MIME.has(contentType)) {
    throw new ApiError(
      502,
      'UPSTREAM_INVALID_IMAGE',
      `结果图 MIME 不受支持（仅 jpeg/png/webp，实际 ${sanitizeDetail(contentType || '未知', secrets)}）`,
    );
  }
  const buf = await readBodyBytesCapped(response, MAX_IMAGE_DOWNLOAD_BYTES);
  if (buf.length === 0) {
    throw new ApiError(502, 'UPSTREAM_EMPTY_IMAGE', '模型服务返回的图片内容为空');
  }
  const mime = detectImageMime(buf);
  if (!mime) {
    throw new ApiError(502, 'IMAGE_DECODE_FAILED', '模型服务返回的图片数据无法解析');
  }
  return `data:image/${mime};base64,${buf.toString('base64')}`;
}

// ---- 错误归一 ----

/**
 * 统一错误归一：ApiError 脱敏透传；中止→504 超时；网络类错误→502 连接失败；其余兜底 502
 */
function normalizeThrownError(err: unknown, secrets: string[]): ApiError {
  if (err instanceof ApiError) {
    return new ApiError(err.status, err.code, sanitizeDetail(err.message, secrets));
  }
  const name =
    typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new ApiError(504, 'UPSTREAM_TIMEOUT', '模型服务响应超时，请稍后重试');
  }
  const message = err instanceof Error ? err.message : String(err);
  const safeMessage = sanitizeDetail(message, secrets);
  if (P_NETWORK.test(message.toLowerCase())) {
    console.error(`[responses-image] 连接模型服务失败：${safeMessage}`);
    return new ApiError(502, 'UPSTREAM_CONNECTION_FAILED', `无法连接模型服务，请检查网络或 base_url 配置（${safeMessage}）`);
  }
  console.error(
    `[responses-image] 未预期错误：${err instanceof Error && err.stack ? sanitizeDetail(err.stack, secrets) : safeMessage}`,
  );
  return new ApiError(502, 'IMAGE_GENERATION_FAILED', `图片生成失败（${safeMessage}）`);
}

// ---- 主函数 ----

/**
 * 调用 Responses API 生成图片，返回 base64 data URL
 * 流程：POST /v1/responses → 解析 SSE → 提取图片（远程 URL 则下载）→ 错误统一归一为 ApiError
 * 超时（默认 120s）经同一 AbortController 覆盖主请求、SSE 读取与图片下载全程
 */
export async function generateImageWithResponsesApi(
  input: ResponsesImageInput,
  deps: ResponsesImageDeps = {},
): Promise<string> {
  if (!input.model) {
    throw new ApiError(400, 'MODEL_NOT_CONFIGURED', 'image-gen 配置中未填模型名称（models），请先在管理平台完成配置');
  }
  // 脱敏密钥含 prompt：上游错误事件/日志会回显用户提示词，与 api_key 一并替换防止外泄
  const secrets = [input.prompt, input.apiKey];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const doFetch = deps.fetch ?? fetch;
    const response = await doFetch(buildResponsesEndpoint(input.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(buildResponsesRequestBody(input)),
      // 同一 signal 既约束主请求，也传给后续图片下载，使超时覆盖「请求→SSE→下载」全程
      signal: controller.signal,
    });
    if (!response.ok) {
      let upstreamBody = '';
      try {
        upstreamBody = await readBodyTextCapped(response);
      } catch {
        void 0;
      }
      throwForHttpStatus(response.status, upstreamBody, secrets);
    }
    if (!response.body) {
      throw new ApiError(502, 'IMAGE_GENERATION_FAILED', '模型服务未返回可读的响应流');
    }
    let extracted: ExtractedImage | null = null;
    let sawInvalidCandidate = false;
    for await (const event of parseSseStream(response.body, secrets)) {
      const attempt = attemptExtractImage(event);
      if (attempt.sawInvalidCandidate) sawInvalidCandidate = true;
      extracted = attempt.image;
      if (extracted) break;
    }
    if (!extracted) {
      // 曾有图片候选但全部校验失败（含 base64 非法/魔数不匹配）→ 解码失败；否则视为上游未返回结果
      if (sawInvalidCandidate) {
        throw new ApiError(502, 'IMAGE_DECODE_FAILED', '模型服务返回的图片数据无法解析');
      }
      throw new ApiError(502, 'UPSTREAM_EMPTY_IMAGE', '模型服务未返回图片结果，请重试');
    }
    if (extracted.kind === 'dataUrl') return extracted.dataUrl;
    return await downloadImageAsDataUrl(extracted.url, doFetch, controller.signal, secrets);
  } catch (err) {
    throw normalizeThrownError(err, secrets);
  } finally {
    clearTimeout(timer);
  }
}
