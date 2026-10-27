import { ApiError } from '../utils/response.js';
import { getDecryptedConfig } from './model-configs.service.js';
import { chatCompletion, type ChatMessage } from './llm-client.service.js';
import { generateImageWithResponsesApi, type ResponsesImageInput } from './responses-image.client.js';

/**
 * 照片 AI 优化：共享契约（场景白名单 + 请求/分析结果类型 + 输入校验）+ 两阶段编排
 * 阶段一多模态 LLM 分析原图产出结构化 JSON → schema 校验 → 组装最终 prompt →
 * 阶段二 Responses API image_generation 重绘；不涉及路由注册
 */

/** 优化场景白名单（顺序固定，前端渲染依赖此顺序） */
export const PHOTO_OPTIMIZE_SCENES = [
  'general',
  'xiaohongshu',
  'moments',
  'douyin',
  'video-cover',
  'travel',
  'portrait',
  'product',
  'food',
  'landscape',
  'portfolio',
] as const;

/** 场景 key 类型 */
export type PhotoOptimizeScene = (typeof PHOTO_OPTIMIZE_SCENES)[number];

/** 场景中文标签映射 */
export const PHOTO_OPTIMIZE_SCENE_LABELS: Record<PhotoOptimizeScene, string> = {
  general: '通用优化',
  xiaohongshu: '小红书',
  moments: '朋友圈',
  douyin: '抖音',
  'video-cover': '视频封面或配图',
  travel: '旅行记录',
  portrait: '人物肖像',
  product: '商品展示',
  food: '餐饮美食',
  landscape: '风景摄影',
  portfolio: '作品集',
};

/** 照片 AI 优化请求（校验通过后的规范化输入） */
export interface PhotoOptimizeRequest {
  image: string;
  scene: PhotoOptimizeScene;
  note?: string;
}

/** 场景白名单类型谓词（收窄 string → PhotoOptimizeScene） */
function isPhotoOptimizeScene(v: string): v is PhotoOptimizeScene {
  return (PHOTO_OPTIMIZE_SCENES as readonly string[]).includes(v);
}

/** 阶段一多模态 LLM 分析结果（directions 各字段允许为空字符串） */
export interface PhotoAnalysis {
  summary: string;
  directions: {
    crop: string;
    tone: string;
    brightness: string;
    content: string;
    style: string;
    platform: string;
  };
  preserve: string[];
  avoid: string[];
}

/** 允许的图片格式（多模态 LLM data URL） */
const IMAGE_DATA_URL_RE = /^data:image\/(?:jpeg|png|webp);base64,/;

/** 图片解码后最大字节数（8MB） */
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** 用户描述最大长度 */
const NOTE_MAX_LENGTH = 500;

/** 估算 data URL base64 载荷解码后的字节数（不含 data URL 前缀） */
function imageDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * 校验并规范化照片 AI 优化入参
 * 图片缺失/格式不符/载荷为空 → INVALID_IMAGE；解码后 >8MB → IMAGE_TOO_LARGE
 * 场景为空或不在白名单 → INVALID_SCENE；描述非字符串 → INVALID_NOTE；描述超长 → NOTE_TOO_LONG
 * @param input 请求体（未信任数据）
 * @returns 规范化输入（note 已 trim，空 note 省略）
 */
export function validatePhotoOptimizeInput(input: unknown): PhotoOptimizeRequest {
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const { image, scene, note } = body;

  // ---- 图片 ----
  if (typeof image !== 'string' || !IMAGE_DATA_URL_RE.test(image)) {
    throw new ApiError(400, 'INVALID_IMAGE', '图片格式不正确，请上传 jpg/png/webp 图片');
  }
  if (!image.slice(image.indexOf(',') + 1)) {
    throw new ApiError(400, 'INVALID_IMAGE', '图片内容为空，请重新上传');
  }
  if (imageDataUrlBytes(image) > IMAGE_MAX_BYTES) {
    throw new ApiError(400, 'IMAGE_TOO_LARGE', '图片过大（最大 8MB），请压缩后重试');
  }

  // ---- 场景 ----
  if (typeof scene !== 'string' || !isPhotoOptimizeScene(scene)) {
    throw new ApiError(400, 'INVALID_SCENE', '优化场景不正确');
  }

  // ---- 描述（可选） ----
  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new ApiError(400, 'INVALID_NOTE', '优化描述必须是字符串');
  }
  const noteText = (typeof note === 'string' ? note : '').trim();
  if (noteText.length > NOTE_MAX_LENGTH) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `优化描述过长（最多 ${NOTE_MAX_LENGTH} 字）`);
  }

  return noteText ? { image, scene, note: noteText } : { image, scene };
}

/**
 * 阶段一分析 system prompt：强制只输出固定 schema 的 JSON
 * （directions 六字段齐全且为字符串，preserve/avoid 为字符串数组）
 */
const ANALYSIS_SYSTEM_PROMPT = `你是照片 AI 优化流程中的前置分析模块。用户提供一张照片、优化场景与可选诉求，你需要分析照片现状，为后续「照片重绘」生成结构化分析。

严格要求：
1. 只输出一个 JSON 对象：不要输出任何 JSON 之外的文字、说明或 markdown 代码围栏。
2. JSON 必须且只能包含以下结构（所有字段必须齐全）：
{
  "summary": "照片现状摘要，一到三句话",
  "directions": {
    "crop": "构图与裁剪方向；无需调整则为空字符串",
    "tone": "影调与色彩方向；无需调整则为空字符串",
    "brightness": "亮度与曝光方向；无需调整则为空字符串",
    "content": "画面内容增删方向（去杂物、补元素等）；无需调整则为空字符串",
    "style": "整体风格方向；无需调整则为空字符串",
    "platform": "平台呈现适配方向（比例、排版、封面感等）；无需调整则为空字符串"
  },
  "preserve": ["重绘时必须原样保留的主体、关键物体或文字"],
  "avoid": ["重绘时不得发生的改变或伪造内容"]
}
3. directions 六个字段均为字符串：无建议时给空字符串 ""，不得省略字段、不得为 null。
4. preserve 与 avoid 均为字符串数组：没有则给空数组 []。
5. 分析要具体、可直接转为执行指令：preserve 列出文字、标识、人脸、商品主体等必须保真的内容；avoid 列出不得被改动或凭空生成的内容。`;

/** 阶段一 user 消息文本（场景标签 + 可选用户诉求） */
function buildAnalysisUserText(req: PhotoOptimizeRequest): string {
  const label = PHOTO_OPTIMIZE_SCENE_LABELS[req.scene];
  const lines = [`优化场景：${label}`];
  lines.push(req.note ? `用户诉求：${req.note}` : '用户诉求：未提供，请按场景做通用优化');
  lines.push('请结合这张照片输出分析 JSON。');
  return lines.join('\n');
}

/**
 * 阶段一：多模态 LLM 分析原图，返回原始模型文本
 * llm 缺配置 → MODEL_NOT_CONFIGURED；调用失败由 llm-client 抛出语义化 ApiError 并原样透传
 */
async function runPhotoAnalysis(req: PhotoOptimizeRequest): Promise<string> {
  const config = getDecryptedConfig('llm');
  if (!config?.base_url || !config.api_key) {
    throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务（llm）尚未配置，请先在管理平台完成配置');
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: buildAnalysisUserText(req) },
        { type: 'image_url', image_url: { url: req.image } },
      ],
    },
  ];
  return chatCompletion(
    { base_url: config.base_url, api_key: config.api_key, models: config.models },
    messages,
  );
}

/** directions 字段顺序（校验与拼装共用） */
const DIRECTION_KEYS = ['crop', 'tone', 'brightness', 'content', 'style', 'platform'] as const;

/** 分析结果不合规错误（模型输出问题 → 502，非用户输入问题） */
function invalidOutput(reason: string): ApiError {
  return new ApiError(502, 'ANALYSIS_INVALID_OUTPUT', `照片分析结果格式不正确（${reason}），请重试`);
}

/**
 * 校验已解析的值为 PhotoAnalysis（parseAnalysisJson 与 /retry 端点共用）
 * 任何字段缺失或类型不符 → ANALYSIS_INVALID_OUTPUT，绝不把自由文本放行到生图阶段
 */
export function validatePhotoAnalysis(value: unknown): PhotoAnalysis {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidOutput('根节点不是对象');
  }
  const obj = value as Record<string, unknown>;
  const { summary, directions, preserve, avoid } = obj;
  if (typeof summary !== 'string' || !summary.trim()) {
    throw invalidOutput('summary 缺失或为空');
  }
  if (typeof directions !== 'object' || directions === null || Array.isArray(directions)) {
    throw invalidOutput('directions 不是对象');
  }
  const dir = directions as Record<string, unknown>;
  const normalizedDirections: PhotoAnalysis['directions'] = {
    crop: '',
    tone: '',
    brightness: '',
    content: '',
    style: '',
    platform: '',
  };
  for (const key of DIRECTION_KEYS) {
    const value = dir[key];
    if (typeof value !== 'string') {
      throw invalidOutput(`directions.${key} 不是字符串`);
    }
    normalizedDirections[key] = value;
  }
  if (!Array.isArray(preserve) || preserve.some((item) => typeof item !== 'string')) {
    throw invalidOutput('preserve 不是字符串数组');
  }
  if (!Array.isArray(avoid) || avoid.some((item) => typeof item !== 'string')) {
    throw invalidOutput('avoid 不是字符串数组');
  }
  return {
    summary: summary.trim(),
    directions: normalizedDirections,
    preserve: preserve as string[],
    avoid: avoid as string[],
  };
}

/**
 * 解析并校验阶段一模型输出为 PhotoAnalysis
 * JSON 提取方式：取文本中第一个 "{" 到最后一个 "}" 的切片再 JSON.parse——
 * 一步同时容忍 markdown 围栏与前后杂质（干净 JSON 时该切片即原文，等价直解）
 * 解析成功后交 validatePhotoAnalysis 做 schema 校验，行为与拆分前完全一致
 */
export function parseAnalysisJson(text: unknown): PhotoAnalysis {
  if (typeof text !== 'string' || !text.trim()) {
    throw invalidOutput('内容为空');
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw invalidOutput('未找到 JSON 对象');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw invalidOutput('JSON 解析失败');
  }
  return validatePhotoAnalysis(parsed);
}

/** 各优化场景的固定中文风格倾向（写入最终 prompt 的场景段） */
const SCENE_STYLE_HINTS: Record<PhotoOptimizeScene, string> = {
  general: '综合提升构图、影调、清晰度与整体质感，保持真实可信',
  xiaohongshu: '竖版 3:4 比例的封面感构图，主体醒目、色彩干净讨喜，适合小红书瀑布流首图',
  moments: '自然真实的日常记录感，不过度修图，像好友随手拍出的好照片',
  douyin: '竖版 9:16 比例，第一眼冲击力强、主体突出、对比鲜明，适合短视频平台快速抓眼',
  'video-cover': '适配目标视频的画面比例，在主体与关键信息周围预留字幕安全区，避免被字幕或界面元素遮挡',
  travel: '强化旅途的氛围与现场感，光线、色彩与环境细节让人身临其境',
  portrait: '五官与身份特征保持真实不变，肤质自然有质感，避免过度磨皮与失真',
  product: '商品主体突出、细节清晰，背景干净简洁，光线均匀无干扰',
  food: '色泽诱人、光线温暖，突出食材纹理与食欲感细节',
  landscape: '层次分明、色彩还原真实自然，远近景细节与天空过渡清晰',
  portfolio: '统一而克制的作品集质感，影调与风格协调，突出作者表达',
};

/** directions 各字段在 prompt 中的展示标签 */
const DIRECTION_LABELS: Record<(typeof DIRECTION_KEYS)[number], string> = {
  crop: '构图与裁剪',
  tone: '影调与色彩',
  brightness: '亮度与曝光',
  content: '画面内容增删',
  style: '整体风格',
  platform: '平台适配',
};

/** 最终 prompt 字符上限 */
const FINAL_PROMPT_MAX_LENGTH = 8000;

/** prompt 组装各段的截断额度（Infinity 表示不截断） */
interface PromptCaps {
  directionValue: number;
  listItem: number;
  listCount: number;
  note: number;
}

/** 截断字符串到指定字符数，被截断时追加省略号 */
function capText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * 组装最终生图 prompt：场景倾向 + 用户诉求 + 非空 directions + 必须保留 + 禁止出现
 * crop 明确写为「必须在本次重绘中实际执行」，而非仅供参考的建议
 * 超过 8000 字符的截断策略（逐级收敛，全部超限才兜底硬切）：
 * 1) 各 direction 值截到 200 字符；2) preserve/avoid 各留前 8 项、每项 100 字符；3) note 截到 200 字符
 * 4) 仍超限则按拼装顺序硬切 8000 字符（前三级后正常不可能触达，仅作最后保险）
 * 场景不在白名单 → INVALID_SCENE
 */
export function buildFinalPrompt(
  analysis: PhotoAnalysis,
  scene: PhotoOptimizeScene,
  note?: string,
): string {
  if (!isPhotoOptimizeScene(scene)) {
    throw new ApiError(400, 'INVALID_SCENE', '优化场景不正确');
  }
  const label = PHOTO_OPTIMIZE_SCENE_LABELS[scene];
  const styleHint = SCENE_STYLE_HINTS[scene];
  const noteText = (note ?? '').trim();

  const assemble = (caps: PromptCaps): string => {
    const parts: string[] = [];
    parts.push(
      '请以用户提供的原图为底图完成一次照片重绘，输出优化后的新照片（图像结果，不是文字说明）。以下全部要求必须落实到最终成图中。',
    );
    parts.push(`【优化场景】${label}：${styleHint}`);
    if (noteText) {
      parts.push(`【用户诉求】${capText(noteText, caps.note)}`);
    }
    parts.push(`【原图现状（供参考，以原图为准）】${capText(analysis.summary.trim(), 500)}`);

    const directionLines: string[] = [];
    for (const key of DIRECTION_KEYS) {
      const value = analysis.directions[key].trim();
      if (!value) continue;
      const label_ = DIRECTION_LABELS[key];
      directionLines.push(
        key === 'crop'
          ? `- ${label_}（必须在本次重绘中实际执行该调整，而不是仅供参考的建议）：${capText(value, caps.directionValue)}`
          : `- ${label_}：${capText(value, caps.directionValue)}`,
      );
    }
    if (directionLines.length) {
      parts.push(`【重绘执行方向】\n${directionLines.join('\n')}`);
    }

    const pick = (items: string[]): string[] =>
      items
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, caps.listCount)
        .map((item) => capText(item, caps.listItem));
    const preserveItems = pick(analysis.preserve);
    if (preserveItems.length) {
      parts.push(
        `【必须保留】以下主体、物体或文字在重绘后必须原样保留，不得删改：\n${preserveItems.map((item) => `- ${item}`).join('\n')}`,
      );
    }
    const avoidItems = pick(analysis.avoid);
    if (avoidItems.length) {
      parts.push(
        `【禁止出现】重绘结果中不得出现以下改变或内容：\n${avoidItems.map((item) => `- ${item}`).join('\n')}`,
      );
    }
    return parts.join('\n\n');
  };

  const noCap: PromptCaps = {
    directionValue: Number.POSITIVE_INFINITY,
    listItem: Number.POSITIVE_INFINITY,
    listCount: Number.POSITIVE_INFINITY,
    note: Number.POSITIVE_INFINITY,
  };
  let prompt = assemble(noCap);
  if (prompt.length > FINAL_PROMPT_MAX_LENGTH) {
    prompt = assemble({ ...noCap, directionValue: 200 });
  }
  if (prompt.length > FINAL_PROMPT_MAX_LENGTH) {
    prompt = assemble({ ...noCap, directionValue: 200, listItem: 100, listCount: 8 });
  }
  if (prompt.length > FINAL_PROMPT_MAX_LENGTH) {
    prompt = assemble({ ...noCap, directionValue: 200, listItem: 100, listCount: 8, note: 200 });
  }
  if (prompt.length > FINAL_PROMPT_MAX_LENGTH) {
    prompt = prompt.slice(0, FINAL_PROMPT_MAX_LENGTH);
  }
  return prompt;
}

/** image-gen 配置视图（image_model 为可选扩展字段，上游要求时随生图请求透传） */
interface ImageGenConfigView {
  base_url: string | null;
  api_key: string | null;
  models: string[];
  image_model?: string;
}

/** 读取 image-gen 配置；image_model 空白时归一为省略（旧配置无该字段同样兼容） */
function readImageGenConfig(): ImageGenConfigView | null {
  const cfg = getDecryptedConfig('image-gen');
  if (!cfg) return null;
  const { image_model: rawImageModel, ...rest } = cfg;
  const imageModel = typeof rawImageModel === 'string' ? rawImageModel.trim() : '';
  return imageModel ? { ...rest, image_model: imageModel } : rest;
}

/** 照片 AI 优化成功结果 */
export interface PhotoOptimizeResult {
  analysis: PhotoAnalysis;
  result_image: string;
}

/** 编排各阶段的可注入实现（冒烟/测试用；缺省为真实实现） */
export interface PhotoOptimizeStages {
  readImageConfig?: () => ImageGenConfigView | null;
  analyze?: (req: PhotoOptimizeRequest) => Promise<string>;
  generate?: (input: ResponsesImageInput) => Promise<string>;
}

/**
 * 生成阶段错误：在保持原 ApiError 状态码/错误码/消息的前提下携带 analysis，
 * 使上层（路由）无需二次分析即可拿到阶段一结果；不修改 utils/response.ts
 */
export class PhotoOptimizeError extends ApiError {
  constructor(
    status: number,
    code: string,
    message: string,
    public readonly details: { analysis: PhotoAnalysis },
  ) {
    super(status, code, message);
  }
}

/** 失败日志：只记录阶段、错误码与耗时（不打 key/完整 prompt/完整 data URL） */
function logStageFailure(stage: string, err: unknown, startedAt: number): void {
  const code = err instanceof ApiError ? err.code : 'UNKNOWN';
  console.error(`[photo-optimize] 阶段=${stage} 失败 code=${code} 耗时=${Date.now() - startedAt}ms`);
}

/** 成功日志：只记录阶段与耗时 */
function logStage(stage: string, startedAt: number): void {
  console.log(`[photo-optimize] 阶段=${stage} 耗时=${Date.now() - startedAt}ms`);
}

/** 阶段一失败原样透传的错误码：设计 §8 错误码集合 + 输入层校验错误码（配合 mapAnalyzeError 使用） */
const ANALYZE_PASSTHROUGH_CODES: ReadonlySet<string> = new Set([
  'RESPONSES_NOT_SUPPORTED',
  'IMAGE_TOOL_NOT_SUPPORTED',
  'ANALYSIS_INVALID_OUTPUT',
  'IMAGE_GENERATION_FAILED',
  'UPSTREAM_AUTH_FAILED',
  'UPSTREAM_RATE_LIMITED',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_CONNECTION_FAILED',
  'UPSTREAM_INVALID_IMAGE',
  'UPSTREAM_EMPTY_IMAGE',
  'IMAGE_DECODE_FAILED',
  'MODEL_NOT_CONFIGURED',
  'INVALID_IMAGE',
  'IMAGE_TOO_LARGE',
  'INVALID_SCENE',
  'INVALID_NOTE',
  'NOTE_TOO_LONG',
]);

/**
 * 阶段一失败错误码映射：
 * - 集合内（设计 §8 错误码 + 输入层校验码）→ 原样透传
 * - 集合外的 ApiError（llm-client 的 LLM_TIMEOUT / UPSTREAM_UNAVAILABLE / UPSTREAM_ERROR /
 *   UPSTREAM_EMPTY 等）→ 改包为 ANALYSIS_FAILED，status 沿用原 ApiError（无则 502）、
 *   message 沿用原 message（llm-client 已脱敏）
 * - 非 ApiError → 兜底包 ANALYSIS_FAILED（502，不透出未知错误细节）
 */
function mapAnalyzeError(err: unknown): ApiError {
  if (err instanceof ApiError) {
    if (ANALYZE_PASSTHROUGH_CODES.has(err.code)) return err;
    return new ApiError(err.status || 502, 'ANALYSIS_FAILED', err.message);
  }
  return new ApiError(502, 'ANALYSIS_FAILED', '照片分析失败，请重试');
}

/** 前置校验通过的 image-gen 配置（base_url、api_key、models[0] 均非空） */
interface ResolvedImageGen {
  imageCfg: ImageGenConfigView | null;
  baseUrl: string;
  apiKey: string;
  imageModel: string;
}

/**
 * 读取并前置校验 image-gen 配置（optimizePhoto 与 regeneratePhoto 共用，同错误码同日志）：
 * 缺 base_url/api_key 或 models[0] → 400 MODEL_NOT_CONFIGURED，日志记阶段=config
 */
function requireImageGenConfig(
  stages: PhotoOptimizeStages,
  startedAt: number,
): ResolvedImageGen {
  const imageCfg = (stages.readImageConfig ?? readImageGenConfig)();
  const baseUrl = imageCfg?.base_url ?? '';
  const apiKey = imageCfg?.api_key ?? '';
  const imageModel = imageCfg?.models[0] ?? '';
  const failConfig = (message: string): never => {
    const err = new ApiError(400, 'MODEL_NOT_CONFIGURED', message);
    logStageFailure('config', err, startedAt);
    throw err;
  };
  if (!baseUrl || !apiKey) {
    failConfig('模型服务（image-gen）尚未配置，请先在管理平台完成配置');
  }
  if (!imageModel) {
    failConfig('模型服务（image-gen）未填模型名称（models），请先在管理平台完成配置');
  }
  return { imageCfg, baseUrl, apiKey, imageModel };
}

/**
 * 阶段二：Responses API image_generation 重绘（optimizePhoto 与 regeneratePhoto 共用）
 * 失败按原 ApiError 的状态码/错误码/消息转 PhotoOptimizeError 携带 analysis；
 * 日志只记阶段=generate 的错误码与耗时（不打 key/完整 prompt/完整 data URL）
 */
async function runGeneration(
  resolved: ResolvedImageGen,
  image: string,
  prompt: string,
  analysis: PhotoAnalysis,
  stages: PhotoOptimizeStages,
): Promise<string> {
  const generateStart = Date.now();
  try {
    const result_image = await (stages.generate ?? generateImageWithResponsesApi)({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.imageModel,
      ...(resolved.imageCfg?.image_model ? { imageModel: resolved.imageCfg.image_model } : {}),
      image,
      prompt,
    });
    logStage('generate', generateStart);
    return result_image;
  } catch (err) {
    logStageFailure('generate', err, generateStart);
    if (err instanceof ApiError) {
      throw new PhotoOptimizeError(err.status, err.code, err.message, { analysis });
    }
    throw new PhotoOptimizeError(502, 'IMAGE_GENERATION_FAILED', '图片生成失败，请重试', { analysis });
  }
}

/**
 * 照片 AI 优化主编排（任何失败均不自动重试）：
 * 1) 入参校验 → 2) image-gen 配置前置校验（必须先于阶段一，避免白分析）→
 * 3) 阶段一多模态分析（失败经 mapAnalyzeError 映射错误码）→ 4) schema 校验 →
 * 5) 组装最终 prompt → 6) Responses API image_generation 重绘（失败以 PhotoOptimizeError 携带 analysis）
 */
export async function optimizePhoto(
  input: unknown,
  stages: PhotoOptimizeStages = {},
): Promise<PhotoOptimizeResult> {
  const startedAt = Date.now();
  const req = validatePhotoOptimizeInput(input);
  const resolved = requireImageGenConfig(stages, startedAt);

  const analyzeStart = Date.now();
  let raw: string;
  try {
    raw = await (stages.analyze ?? runPhotoAnalysis)(req);
  } catch (err) {
    // 日志保留原错误码便于定位上游根因，对外响应用映射后的 code
    logStageFailure('analyze', err, analyzeStart);
    throw mapAnalyzeError(err);
  }
  logStage('analyze', analyzeStart);

  let analysis: PhotoAnalysis;
  try {
    analysis = parseAnalysisJson(raw);
  } catch (err) {
    logStageFailure('parse', err, analyzeStart);
    throw err;
  }

  const prompt = buildFinalPrompt(analysis, req.scene, req.note);
  const result_image = await runGeneration(resolved, req.image, prompt, analysis, stages);
  return { analysis, result_image };
}

/**
 * 仅重发生图（POST /api/ai/photo-optimize/retry，供生图阶段失败后的手动重试）：
 * 1) 入参与主流程同口径校验 → 2) image-gen 配置前置校验 → 3) 重新校验前端传回的 analysis
 * （不信任前端；不合法 → ANALYSIS_INVALID_OUTPUT，不会进入生图）→
 * 4) 组装最终 prompt → 5) Responses API 重绘（失败以 PhotoOptimizeError 携带 analysis）
 * 不调用阶段一（不打 llm）、无自动重试；日志同规范（阶段/错误码/耗时，无敏感信息）
 */
export async function regeneratePhoto(
  input: unknown,
  stages: PhotoOptimizeStages = {},
): Promise<PhotoOptimizeResult> {
  const startedAt = Date.now();
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const req = validatePhotoOptimizeInput(body);
  const resolved = requireImageGenConfig(stages, startedAt);

  let analysis: PhotoAnalysis;
  try {
    analysis = validatePhotoAnalysis(body.analysis);
  } catch (err) {
    logStageFailure('validate-analysis', err, startedAt);
    throw err;
  }

  const prompt = buildFinalPrompt(analysis, req.scene, req.note);
  const result_image = await runGeneration(resolved, req.image, prompt, analysis, stages);
  return { analysis, result_image };
}
