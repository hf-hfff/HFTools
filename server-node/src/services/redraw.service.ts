import { ApiError } from '../utils/response.js';
import { getResolvedConfig } from './model-configs.service.js';
import { generateImageWithEdits } from './image-edit.client.js';
import { fileUrl, saveDataUrlImage, uniqueBaseName, type SaveImageOptions } from './file-store.js';
import { templateExists, parseTemplateId } from './redraw-templates.service.js';
import { enforceCapacity, saveHistory } from './redraw-history.service.js';

/**
 * 影像 AI 重绘：用户原图 + 最终提示词 → images/edits → 落盘 → 写历史 → 返回 URL
 * 与照片AI优化的关键差异：不回 base64，返回同源 URL（每次都要写历史，避免同一张图走两遍网络）
 */

/** 允许的图片 data URL（与照片优化同口径） */
const IMAGE_DATA_URL_RE = /^data:image\/(?:jpeg|png|webp);base64,/;

/** 原图解码后上限（20MB，与照片点评/照片优化统一） */
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** 提示词长度上限（与模板正文一致） */
const PROMPT_MAX_LENGTH = 10_000;

/** 原图落盘校验参数（复用通用错误码） */
const SOURCE_SAVE_OPTIONS: SaveImageOptions = {
  maxBytes: IMAGE_MAX_BYTES,
  invalidCode: 'INVALID_IMAGE',
  invalidMessage: '图片格式不正确，请上传 jpg/png/webp 图片',
  tooLargeCode: 'IMAGE_TOO_LARGE',
  tooLargeMessage: '图片过大（最大 20MB），请压缩后重试',
};

/** 结果图落盘校验参数：上游异常产物不走用户错误码，统一按生成失败处理 */
const RESULT_SAVE_OPTIONS: SaveImageOptions = {
  maxBytes: 32 * 1024 * 1024,
  invalidCode: 'IMAGE_DECODE_FAILED',
  invalidMessage: '模型服务返回的图片数据无法解析',
  tooLargeCode: 'IMAGE_GENERATION_FAILED',
  tooLargeMessage: '模型服务返回的图片过大，请重试',
};

/** 校验后的重绘入参 */
export interface RedrawRequest {
  image: string;
  prompt: string;
  templateId: number | null;
}

/** 重绘结果：图片以 URL 返回，history_id 为 null 表示历史写入失败（结果图仍可用） */
export interface RedrawResult {
  history_id: number | null;
  source_url: string;
  result_url: string;
  prompt: string;
}

/** 估算 data URL 载荷解码后的字节数 */
function imageDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * 校验重绘入参（不信任前端）：
 * image 必须是 jpg/png/webp data URL 且解码后 ≤20MB → INVALID_IMAGE / IMAGE_TOO_LARGE
 * prompt trim 后 1–10000 字 → EMPTY_PROMPT / PROMPT_TOO_LONG
 * template_id 可选，提供时必须存在 → TEMPLATE_NOT_FOUND
 */
export function validateRedrawInput(input: unknown): RedrawRequest {
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const { image, prompt, template_id: templateIdRaw } = body;

  if (typeof image !== 'string' || !IMAGE_DATA_URL_RE.test(image)) {
    throw new ApiError(400, 'INVALID_IMAGE', '图片格式不正确，请上传 jpg/png/webp 图片');
  }
  if (!image.slice(image.indexOf(',') + 1)) {
    throw new ApiError(400, 'INVALID_IMAGE', '图片内容为空，请重新上传');
  }
  if (imageDataUrlBytes(image) > IMAGE_MAX_BYTES) {
    throw new ApiError(400, 'IMAGE_TOO_LARGE', '图片过大（最大 20MB），请压缩后重试');
  }

  const promptText = typeof prompt === 'string' ? prompt.trim() : '';
  if (!promptText) {
    throw new ApiError(400, 'EMPTY_PROMPT', '请先输入或选择提示词');
  }
  if (promptText.length > PROMPT_MAX_LENGTH) {
    throw new ApiError(400, 'PROMPT_TOO_LONG', `提示词过长（最多 ${PROMPT_MAX_LENGTH} 字）`);
  }

  let templateId: number | null = null;
  if (templateIdRaw !== undefined && templateIdRaw !== null && templateIdRaw !== '') {
    templateId = parseTemplateId(templateIdRaw);
    if (!templateExists(templateId)) {
      throw new ApiError(404, 'TEMPLATE_NOT_FOUND', '模板不存在或已删除');
    }
  }

  return { image, prompt: promptText, templateId };
}

/** 失败日志：只记阶段、错误码与耗时（不打 key / 完整 prompt / 完整 data URL） */
function logFailure(stage: string, code: string, startedAt: number): void {
  console.error(`[image-redraw] 阶段=${stage} 失败 code=${code} 耗时=${Date.now() - startedAt}ms`);
}

/**
 * 重绘主编排（失败不自动重试）：
 * 1) 入参校验 → 2) 模型配置校验 → 3) images/edits 出图 →
 * 4) 原图与结果图并发落盘（失败即 502，没有文件就没有可访问 URL）→
 * 5) 写历史 + 容量清理（失败只记日志，绝不阻断返回结果图）
 */
export async function redraw(input: unknown): Promise<RedrawResult> {
  const startedAt = Date.now();
  const req = validateRedrawInput(input);

  const config = getResolvedConfig();
  if (!config.base_url || !config.api_key) {
    const err = new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务尚未配置，请先在管理平台完成配置');
    logFailure('config', err.code, startedAt);
    throw err;
  }
  if (!config.default_model) {
    const err = new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务尚未配置默认模型，请先在管理平台完成配置');
    logFailure('config', err.code, startedAt);
    throw err;
  }

  const generateStart = Date.now();
  let resultDataUrl: string;
  try {
    resultDataUrl = await generateImageWithEdits({
      baseUrl: config.base_url,
      apiKey: config.api_key,
      model: config.default_model,
      imageModel: config.image_model,
      image: req.image,
      prompt: req.prompt,
    });
  } catch (err) {
    logFailure('generate', err instanceof ApiError ? err.code : 'UNKNOWN', generateStart);
    throw err;
  }
  console.log(`[image-redraw] 阶段=generate 耗时=${Date.now() - generateStart}ms`);

  // 原图与结果图共用基名，-src / -out 后缀便于排查
  const baseName = uniqueBaseName();
  let saved: { source: { relPath: string; bytes: number }; result: { relPath: string; bytes: number } };
  try {
    const [source, result] = await Promise.all([
      saveDataUrlImage(req.image, 'history', `${baseName}-src`, SOURCE_SAVE_OPTIONS),
      saveDataUrlImage(resultDataUrl, 'history', `${baseName}-out`, RESULT_SAVE_OPTIONS),
    ]);
    saved = { source, result };
  } catch (err) {
    logFailure('save', err instanceof ApiError ? err.code : 'IMAGE_STORAGE_FAILED', startedAt);
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, 'IMAGE_STORAGE_FAILED', '图片保存失败，请检查磁盘空间');
  }

  let historyId: number | null = null;
  try {
    historyId = saveHistory({
      sourcePath: saved.source.relPath,
      resultPath: saved.result.relPath,
      prompt: req.prompt,
      templateId: req.templateId,
      sourceBytes: saved.source.bytes,
      resultBytes: saved.result.bytes,
    });
    await enforceCapacity();
  } catch (err) {
    // 用户已等待数十秒，历史写入失败不能连带结果图一起丢掉
    console.error(
      '[image-redraw] 历史写入失败',
      err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    );
    historyId = null;
  }

  console.log(`[image-redraw] 阶段=done 耗时=${Date.now() - startedAt}ms`);
  return {
    history_id: historyId,
    source_url: fileUrl(saved.source.relPath),
    result_url: fileUrl(saved.result.relPath),
    prompt: req.prompt,
  };
}
