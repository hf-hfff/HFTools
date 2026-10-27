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

/** 照片 AI 优化场景白名单（顺序与后端 PHOTO_OPTIMIZE_SCENES 固定一致，前端按此顺序渲染） */
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

/** 照片 AI 优化场景 key 类型 */
export type PhotoOptimizeScene = (typeof PHOTO_OPTIMIZE_SCENES)[number];

/** 照片 AI 优化场景中文标签（与后端 PHOTO_OPTIMIZE_SCENE_LABELS 一致） */
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

/** 阶段一多模态 LLM 结构化分析结果（directions 允许为空字符串，preserve/avoid 允许为空数组） */
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

/** 照片 AI 优化请求参数：image 为 base64 data URL，note 为可选优化诉求（≤500 字） */
export interface PhotoOptimizeParams {
  image: string;
  scene: PhotoOptimizeScene;
  note?: string;
}

/** 照片 AI 优化响应体：结构化分析 + 重绘结果图（base64 data URL） */
export interface PhotoOptimizeResult {
  analysis: PhotoAnalysis;
  result_image: string;
}

/** 照片 AI 优化链路超时（ms）：须大于后端最坏链路（阶段一分析 ≈90s + 生图 ≈120s ≈ 210s），完整提交与仅重发生图共用 */
const PHOTO_OPTIMIZE_TIMEOUT_MS = 240_000;

/**
 * 提交照片 AI 优化：单次 POST 串联「分析 → 生图」两阶段
 * timeout 默认 240s（见 PHOTO_OPTIMIZE_TIMEOUT_MS）
 */
export async function photoOptimize(
  params: PhotoOptimizeParams,
  timeoutMs = PHOTO_OPTIMIZE_TIMEOUT_MS,
): Promise<PhotoOptimizeResult> {
  const res = await http.post<ApiResponse<PhotoOptimizeResult>>(
    '/ai/photo-optimize',
    params,
    { timeout: timeoutMs },
  );
  return res.data.data;
}

/** 照片 AI 优化重试请求参数：完整输入外加阶段一 analysis（后端会重新校验） */
export interface PhotoOptimizeRetryParams extends PhotoOptimizeParams {
  analysis: PhotoAnalysis;
}

/**
 * 仅重发生图重试：生成阶段失败后携带已有 analysis 再次提交，后端跳过阶段一分析
 * timeout 与完整优化共用 PHOTO_OPTIMIZE_TIMEOUT_MS（生图最坏 ≈120s）
 */
export async function photoOptimizeRetry(
  params: PhotoOptimizeRetryParams,
  timeoutMs = PHOTO_OPTIMIZE_TIMEOUT_MS,
): Promise<PhotoOptimizeResult> {
  const res = await http.post<ApiResponse<PhotoOptimizeResult>>(
    '/ai/photo-optimize/retry',
    params,
    { timeout: timeoutMs },
  );
  return res.data.data;
}
