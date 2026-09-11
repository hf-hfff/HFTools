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
