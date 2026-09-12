import { http } from './http';
import type { ApiResponse } from '@/types';

/** 照片点评响应体 */
export interface PhotoReviewResult {
  review: string;
}

/**
 * 提交照片点评：image 为 base64 data URL，note 为可选拍摄描述
 * 单独放宽 timeout（点评生成为长文本任务，通常 10-60 秒）
 */
export async function reviewPhoto(image: string, note?: string): Promise<PhotoReviewResult> {
  const res = await http.post<ApiResponse<PhotoReviewResult>>(
    '/ai/photo-review',
    { image, note },
    { timeout: 120_000 },
  );
  return res.data.data;
}

/** 提示词优化响应体 */
export interface PromptOptimizeResult {
  result: string;
}

/** 提示词优化请求参数：level=提示词级别，scene=应用场景 */
export interface PromptOptimizeParams {
  prompt: string;
  level: 'user' | 'system';
  scene: 'text' | 'image' | 'video' | 'code';
}

/**
 * 提交提示词优化：单轮 LLM 生成 Markdown 结果
 * 单独放宽 timeout（优化为长文本任务，通常 10-60 秒）
 */
export async function optimizePrompt(
  params: PromptOptimizeParams,
): Promise<PromptOptimizeResult> {
  const res = await http.post<ApiResponse<PromptOptimizeResult>>(
    '/ai/prompt-optimize',
    params,
    { timeout: 120_000 },
  );
  return res.data.data;
}
