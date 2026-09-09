import { http } from './http';
import type { ApiResponse, Tool } from '@/types';

/** 获取已启用的工具列表（用户端公开接口） */
export async function getEnabledTools(): Promise<Tool[]> {
  const res = await http.get<ApiResponse<Tool[]>>('/tools');
  return res.data.data ?? [];
}
