import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDecryptedConfig } from './model-configs.service.js';
import { chatCompletion, type ChatMessage } from './llm-client.service.js';
import { ApiError } from '../utils/response.js';

/**
 * 照片点评：复用摄影点评 skill（assets/photo-review）作为 system prompt，
 * 代理调用多模态 LLM，返回 Markdown 点评文本（无状态，不落库）
 */

/** 允许的图片格式（多模态 LLM data URL） */
const IMAGE_DATA_URL_RE = /^data:image\/(?:jpeg|png|webp);base64,/;

/** 用户描述最大长度 */
const NOTE_MAX_LENGTH = 500;

/** 熊猫动图标记替换：LLM 输出的相对文件名（可能带任意路径前缀）→ 站点相对 URL */
const PANDA_GIF_RE = /(?:[^\s()]*\/)?(panda_(?:hospital|office|car_window))\.gif/g;
const PANDA_GIF_URL = '/static/photo-review/$1.gif';

/** assets/photo-review 目录（兼容本地 tsx 与 Docker /app/dist 运行） */
const ASSET_DIR = fileURLToPath(new URL('../../assets/photo-review', import.meta.url));

/** 懒加载缓存的 system prompt */
let cachedSystemPrompt: string | null = null;

/** 读取并拼接 SKILL.md + references/style-guide.md 为 system prompt */
function loadSystemPrompt(): string {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const skill = readFileSync(`${ASSET_DIR}/SKILL.md`, 'utf-8');
  const styleGuide = readFileSync(`${ASSET_DIR}/references/style-guide.md`, 'utf-8');
  cachedSystemPrompt = `${skill}\n\n---\n\n# 附录\n\n${styleGuide}`;
  return cachedSystemPrompt;
}

/**
 * 点评一张照片
 * @param image base64 data URL（data:image/jpeg|png|webp;base64,...）
 * @param note 用户拍摄意图/背景描述（可选，≤500 字）
 * @returns Markdown 点评文本（熊猫动图路径已替换为 /static/photo-review/...）
 */
export async function reviewPhoto(image: unknown, note: unknown): Promise<string> {
  // ---- 入参校验 ----
  if (typeof image !== 'string' || !IMAGE_DATA_URL_RE.test(image)) {
    throw new ApiError(400, 'INVALID_IMAGE', '图片格式不正确，请上传 jpg/png/webp 图片');
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new ApiError(400, 'INVALID_NOTE', '照片描述必须是字符串');
  }
  const noteText = (note ?? '').trim();
  if (noteText.length > NOTE_MAX_LENGTH) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `照片描述过长（最多 ${NOTE_MAX_LENGTH} 字）`);
  }

  // ---- 模型配置 ----
  const config = getDecryptedConfig('llm');
  const baseUrl = config?.base_url;
  const apiKey = config?.api_key;
  if (!config || !baseUrl || !apiKey) {
    throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务（llm）尚未配置，请先在管理平台完成配置');
  }

  // ---- 组装多模态消息 ----
  const messages: ChatMessage[] = [
    { role: 'system', content: loadSystemPrompt() },
    {
      role: 'user',
      content: [
        { type: 'text', text: noteText || '请点评这张照片。' },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];

  // ---- 调用 LLM 并替换熊猫动图路径 ----
  const review = await chatCompletion(
    { base_url: baseUrl, api_key: apiKey, models: config.models },
    messages,
  );
  return review.replace(PANDA_GIF_RE, PANDA_GIF_URL);
}
