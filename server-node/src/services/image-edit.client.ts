import { ApiError } from '../utils/response.js';
import {
  throwForHttpStatus,
  downloadImageAsDataUrl,
  detectImageMime,
  type ResponsesImageInput,
} from './responses-image.client.js';

/**
 * 图片编辑客户端（POST {base_url}/images/edits，multipart/form-data）
 *
 * 照片 AI 优化的生图阶段使用：按优化提示词改写原图，保留画面内容。
 * 相比 Responses 的 image_generation 工具，该端点是 OpenAI 标准的图生图接口，
 * 兼容性更好（部分中转不支持 Responses 工具调度，但支持 images/edits）。
 *
 * 错误语义与 responses-image 保持一致：401/403 鉴权、429 限流、408/504 超时、
 * 400 走文本细分类，其余兜底 IMAGE_GENERATION_FAILED。
 */

/** 生图默认超时（实测该端点出图 35-60s；上限须小于前端照片优化总超时） */
const DEFAULT_TIMEOUT_MS = 150_000;

/** data URL 解析（与 responses-image 的入参约定一致） */
const DATA_URL_RE = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]*)$/i;

/** mime → 上传文件名后缀（部分上游按后缀判断类型） */
const EXT_BY_MIME: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/** images/edits 响应体 */
interface EditsResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
}

/** 依赖注入（fetch 可注入，便于测试） */
export interface ImageEditDeps {
  fetch?: typeof fetch;
}

/** 拼接 images/edits 完整地址（兼容 base_url 带不带 /v1、已带 /images/edits、结尾斜杠） */
export function buildEditsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/images\/edits$/.test(trimmed)) return trimmed;
  if (/\/v1$/.test(trimmed)) return `${trimmed}/images/edits`;
  return `${trimmed}/v1/images/edits`;
}

/**
 * 调用 images/edits 生成图片，返回 base64 data URL
 * 入参与 generateImageWithResponsesApi 完全一致，便于在照片优化链路中互换实现
 */
export async function generateImageWithEdits(
  input: ResponsesImageInput,
  deps: ImageEditDeps = {},
): Promise<string> {
  if (!input.imageModel) {
    throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '未配置生图模型，请先在管理平台完成配置');
  }

  const match = DATA_URL_RE.exec(input.image);
  if (!match) {
    throw new ApiError(400, 'INVALID_IMAGE', '原图格式不正确，请上传 jpg/png/webp 图片');
  }
  const subtype = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  if (subtype !== 'jpeg' && subtype !== 'png' && subtype !== 'webp') {
    throw new ApiError(400, 'INVALID_IMAGE', '原图格式不受支持（仅 jpg/png/webp）');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    throw new ApiError(400, 'INVALID_IMAGE', '原图数据为空，请重新上传');
  }

  const form = new FormData();
  form.append('model', input.imageModel);
  form.append(
    'image',
    new Blob([new Uint8Array(buffer)], { type: `image/${subtype}` }),
    `input.${EXT_BY_MIME[subtype] ?? 'png'}`,
  );
  form.append('prompt', input.prompt);

  // 脱敏密钥含 prompt：上游错误响应可能回显提示词
  const secrets = [input.prompt, input.apiKey];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doFetch = deps.fetch ?? fetch;

  try {
    const response = await doFetch(buildEditsEndpoint(input.baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      let body = '';
      try {
        body = (await response.text()).slice(0, 4096);
      } catch {
        void 0;
      }
      throwForHttpStatus(response.status, body, secrets);
    }

    let json: EditsResponse;
    try {
      json = (await response.json()) as EditsResponse;
    } catch {
      throw new ApiError(502, 'IMAGE_GENERATION_FAILED', '模型服务返回了无法解析的响应');
    }

    const first = json.data?.[0];
    const b64 = typeof first?.b64_json === 'string' ? first.b64_json.replace(/\s+/g, '') : '';
    if (b64) {
      const mime = detectImageMime(Buffer.from(b64, 'base64'));
      if (!mime) {
        throw new ApiError(502, 'IMAGE_DECODE_FAILED', '模型服务返回的图片数据无法解析');
      }
      return `data:image/${mime};base64,${b64}`;
    }
    if (typeof first?.url === 'string' && first.url) {
      return await downloadImageAsDataUrl(first.url, doFetch, controller.signal, secrets);
    }
    throw new ApiError(502, 'UPSTREAM_EMPTY_IMAGE', '模型服务未返回图片结果，请重试');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const name =
      typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new ApiError(504, 'UPSTREAM_TIMEOUT', '模型服务响应超时，请稍后重试');
    }
    console.error(
      '[image-edit] 生图请求失败:',
      err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    );
    throw new ApiError(
      502,
      'IMAGE_GENERATION_FAILED',
      `图片生成失败（${err instanceof Error ? err.message.slice(0, 120) : '未知错误'}）`,
    );
  } finally {
    clearTimeout(timer);
  }
}
