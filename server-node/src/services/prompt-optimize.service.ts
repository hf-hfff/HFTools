import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDecryptedConfig } from './model-configs.service.js';
import { chatCompletion, type ChatMessage } from './llm-client.service.js';
import { ApiError } from '../utils/response.js';

/**
 * 提示词优化：按「级别片段 + 场景片段」拼接 system prompt（assets/prompt-optimize），
 * 单轮直连 LLM，返回 Markdown 结果（优化后提示词 + 改动说明，无状态，不落库）
 */

/** 原始提示词最大长度（字符数） */
const PROMPT_MAX_LENGTH = 500;

/** 提示词级别 */
export type PromptLevel = 'user' | 'system';

/** 应用场景 */
export type PromptScene = 'text' | 'image' | 'video' | 'code';

/** assets/prompt-optimize 目录（兼容本地 tsx 与 Docker /app/dist 运行） */
const ASSET_DIR = fileURLToPath(new URL('../../assets/prompt-optimize', import.meta.url));

/** system prompt 缓存：key = level:scene */
const promptCache = new Map<string, string>();

/** 按级别 + 场景拼接 system prompt：base + level 片段 + scene 片段 */
function loadSystemPrompt(level: PromptLevel, scene: PromptScene): string {
  const key = `${level}:${scene}`;
  const cached = promptCache.get(key);
  if (cached) return cached;
  const base = readFileSync(`${ASSET_DIR}/base.md`, 'utf-8');
  const levelPart = readFileSync(`${ASSET_DIR}/level-${level}.md`, 'utf-8');
  const scenePart = readFileSync(`${ASSET_DIR}/scene-${scene}.md`, 'utf-8');
  const prompt = `${base}\n\n---\n\n${levelPart}\n\n---\n\n${scenePart}`;
  promptCache.set(key, prompt);
  return prompt;
}

/**
 * 优化一段草稿提示词
 * @param prompt 原始提示词（非空，≤500 字）
 * @param level 级别：user 用户提示词 / system 系统提示词
 * @param scene 场景：text / image / video / code
 * @returns Markdown 结果（优化后提示词 + 改动说明）
 */
export async function optimizePrompt(
  prompt: unknown,
  level: unknown,
  scene: unknown,
): Promise<string> {
  // ---- 入参校验 ----
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new ApiError(400, 'PROMPT_REQUIRED', '请输入要优化的提示词');
  }
  if (prompt.length > PROMPT_MAX_LENGTH) {
    throw new ApiError(400, 'PROMPT_TOO_LONG', `提示词过长（最多 ${PROMPT_MAX_LENGTH} 字）`);
  }
  if (level !== 'user' && level !== 'system') {
    throw new ApiError(400, 'INVALID_LEVEL', '提示词级别不正确（user / system）');
  }
  const SCENES = ['text', 'image', 'video', 'code'] as const;
  if (typeof scene !== 'string' || !SCENES.includes(scene as (typeof SCENES)[number])) {
    throw new ApiError(400, 'INVALID_SCENE', '应用场景不正确（text / image / video / code）');
  }

  // ---- 模型配置 ----
  const config = getDecryptedConfig('llm');
  if (!config?.base_url || !config.api_key) {
    throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务（llm）尚未配置，请先在管理平台完成配置');
  }

  // ---- 组装消息（单轮：system 模板 + 用户原始提示词）----
  const messages: ChatMessage[] = [
    { role: 'system', content: loadSystemPrompt(level, scene as PromptScene) },
    { role: 'user', content: `请优化以下提示词：\n\n${prompt.trim()}` },
  ];

  return chatCompletion(
    { base_url: config.base_url, api_key: config.api_key, models: config.models },
    messages,
  );
}
