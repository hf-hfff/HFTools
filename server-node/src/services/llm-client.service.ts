import { ApiError } from '../utils/response.js';

/**
 * OpenAI 兼容 LLM 客户端：POST {base_url}/chat/completions
 * 前端零密钥，所有调用经后端代理；model 取配置 models[0]（多模型切换延后）
 */

/** chat/completions 消息格式（支持多模态 content 数组） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

/** 已解密的模型配置（来自 model-configs.service.getDecryptedConfig） */
export interface LlmClientConfig {
  base_url: string;
  api_key: string;
  models: string[];
}

/** 非流式补全返回 */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** LLM 请求默认超时（点评生成为长文本任务） */
const DEFAULT_TIMEOUT_MS = 90_000;

/** 拼接 chat/completions 完整地址（兼容 base_url 带不带 /v1、结尾斜杠） */
function buildEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * 调用 LLM 非流式补全，返回 assistant 文本
 * 网络失败/鉴权失败→502（UPSTREAM_UNAVAILABLE / UPSTREAM_AUTH_FAILED）
 * 上游 429→429；超时→504；响应缺 content→502
 */
export async function chatCompletion(
  config: LlmClientConfig,
  messages: ChatMessage[],
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const model = config.models[0];
  if (!model) {
    throw new ApiError(400, 'MODEL_NOT_CONFIGURED', 'llm 配置中未填模型名称（models），请先在管理平台完成配置');
  }

  let response: Response;
  try {
    response = await fetch(buildEndpoint(config.base_url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.api_key}`,
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ApiError(504, 'LLM_TIMEOUT', '模型服务响应超时，请稍后重试');
    }
    console.error('[llm-client] 连接模型服务失败:', err);
    throw new ApiError(
      502,
      'UPSTREAM_UNAVAILABLE',
      `无法连接模型服务，请检查网络或 base_url 配置（${err instanceof Error ? err.message : '未知错误'}）`,
    );
  }

  if (!response.ok) {
    // 读取上游错误详情（截断），随错误返回并落日志，便于定位上游间歇性失败原因
    let upstreamDetail = '';
    try {
      upstreamDetail = (await response.text()).slice(0, 300);
    } catch {
      // 上游错误体不可读时忽略
    }
    const detail = upstreamDetail ? `：${upstreamDetail}` : '';
    console.error(`[llm-client] 模型服务返回 HTTP ${response.status}${detail}`);
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(502, 'UPSTREAM_AUTH_FAILED', `模型服务鉴权失败，请检查 api_key 是否有效${detail}`);
    }
    if (response.status === 429) {
      throw new ApiError(429, 'UPSTREAM_RATE_LIMITED', `模型服务限流，请稍后重试${detail}`);
    }
    throw new ApiError(502, 'UPSTREAM_ERROR', `模型服务返回错误（HTTP ${response.status}）${detail}`);
  }

  let data: ChatCompletionResponse;
  try {
    data = (await response.json()) as ChatCompletionResponse;
  } catch {
    throw new ApiError(502, 'UPSTREAM_ERROR', '模型服务返回了无法解析的响应');
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new ApiError(502, 'UPSTREAM_EMPTY', '模型服务未返回有效内容，请重试');
  }
  return content;
}
