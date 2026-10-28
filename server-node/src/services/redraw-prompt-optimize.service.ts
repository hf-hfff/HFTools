import { ApiError } from '../utils/response.js';
import { getResolvedConfig } from './model-configs.service.js';
import { chatCompletion, type ChatMessage } from './llm-client.service.js';

/**
 * 重绘提示词优化：纯文本改写（不发原图），全量输入不截断
 * 长文本（≤10000 字）进、接近同等长度出，超时按长文本任务设定 180s
 */

/** 优化超时（长文本 token 消耗与耗时都是短文本的数十倍） */
const OPTIMIZE_TIMEOUT_MS = 180_000;

/** 提示词长度上限（与模板正文、重绘入参一致） */
const PROMPT_MAX_LENGTH = 10_000;

/** 上游上下文超限的报错关键字（各家中转措辞不一，统一识别） */
const CONTEXT_HINTS = /context[_ ]length|maximum context|too many tokens|prompt is too long|reduce the length/i;

/**
 * 优化 system prompt：保留原意、具体化、长输入按段优化且不压缩信息
 * 与照片优化的 ANALYSIS_SYSTEM_PROMPT 同一书写风格（要求-约束-输出形态三段式）
 */
const OPTIMIZE_SYSTEM_PROMPT = `你是「AI 图像重绘」流程中的提示词优化助手。用户提供一段用于图生图（image-to-image）重绘的提示词，你需要在保留其核心创作意图的前提下改写它，使其更适合作为图像生成模型的输入。

优化原则：
1. 保留原意：不改变用户指定的主体、场景、风格方向和情绪基调；用户没提的主体不得擅自新增。
2. 具体化而非堆砌：把模糊表述替换为可视化的描述（构图、视角、镜头、光线方向与质感、色彩关系、材质、景深、画面层次），避免空洞的形容词堆叠。
3. 结构清晰：短输入（约 500 字以内）按「主体 → 环境与背景 → 构图与视角 → 光线 → 色彩与影调 → 材质与细节 → 风格与媒介 → 画面质量」的顺序组织；长输入保留原文的段落划分与逻辑顺序，按段逐段优化，不整体重排、不合并段落。统一用自然语言段落或短句表达，不使用标题、编号、markdown 语法。
4. 保护原图信息：这是图生图任务，输出中应包含对原图需保留内容的约束（如人物身份、关键物体、文字标识），避免模型过度改动。
5. 规避风险：不要生成涉及真实可识别个人、商标、受版权保护的具体作品名称的描述；不要添加暴力、色情、违法违规内容。
6. 长度控制：输出长度随输入自适应。原文较短时不强行扩写；原文较长时按段落逐段优化，不压缩、不删减原文已有的有效信息，输出长度可与原文相当。完整保留原文的结构与信息点是硬要求。
7. 语言一致：输出语言与输入语言保持一致。
8. 唯一输出：只输出优化后的提示词正文，不要解释优化思路，不要加引号，不要加代码围栏，不要输出"优化后："之类的前缀。

如果输入内容为空、无意义或明显不是图像描述，原样返回一个最简的通用重绘提示词，不要报错说明。`;

/** 兜底：模型偶尔仍会套代码围栏，回填前剥离 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return (match ? match[1] : trimmed).trim();
}

/**
 * 优化重绘提示词（全量输入，不做截断）
 * 空/超长输入在调用上游前拦截；上游上下文超限映射为 PROMPT_OPTIMIZE_TOO_LONG，
 * 其余失败统一包为 PROMPT_OPTIMIZE_FAILED（前端保留原提示词，不自动重试）
 */
export async function optimizeRedrawPrompt(input: unknown): Promise<string> {
  // 同时接受 { prompt } 与裸字符串，避免调用方传错形态时被误判为「空输入」
  const body: Record<string, unknown> =
    typeof input === 'string' ? { prompt: input } : ((input ?? {}) as Record<string, unknown>);
  const { prompt } = body;

  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text) {
    throw new ApiError(400, 'EMPTY_PROMPT', '请先输入提示词');
  }
  if (text.length > PROMPT_MAX_LENGTH) {
    throw new ApiError(400, 'PROMPT_TOO_LONG', `提示词过长（最多 ${PROMPT_MAX_LENGTH} 字）`);
  }

  const config = getResolvedConfig();
  if (!config.base_url || !config.api_key || !config.default_model) {
    throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务尚未配置，请先在管理平台完成配置');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
    { role: 'user', content: text },
  ];

  const startedAt = Date.now();
  try {
    const raw = await chatCompletion(
      {
        base_url: config.base_url,
        api_key: config.api_key,
        model: config.default_model,
        reasoning_effort: config.reasoning_effort,
      },
      messages,
      { timeoutMs: OPTIMIZE_TIMEOUT_MS },
    );
    const result = stripCodeFence(raw);
    if (!result) {
      throw new ApiError(502, 'PROMPT_OPTIMIZE_FAILED', '优化结果为空，已保留原提示词');
    }
    console.log(`[redraw-optimize] 耗时=${Date.now() - startedAt}ms 字数=${result.length}`);
    return result;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'PROMPT_OPTIMIZE_FAILED') throw err;
    const code = err instanceof ApiError ? err.code : 'UNKNOWN';
    console.error(`[redraw-optimize] 失败 code=${code} 耗时=${Date.now() - startedAt}ms`);
    const message = err instanceof Error ? err.message : '';
    // 上下文超限：上游会包成 UPSTREAM_ERROR 且 message 带 HTTP 400 与原始报错文本
    if (CONTEXT_HINTS.test(message)) {
      throw new ApiError(
        400,
        'PROMPT_OPTIMIZE_TOO_LONG',
        '提示词过长，超出模型上下文限制，请分段优化或减少篇幅',
      );
    }
    throw new ApiError(
      502,
      'PROMPT_OPTIMIZE_FAILED',
      `提示词优化失败，已保留原提示词${message ? `（${message.slice(0, 120)}）` : ''}`,
    );
  }
}
