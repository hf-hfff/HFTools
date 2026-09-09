import { http } from './http';
import type { ApiResponse, ModelConfig, ModelType, Tool } from '@/types';

/** 管理员登录，返回 JWT */
export async function adminLogin(username: string, password: string): Promise<string> {
  const res = await http.post<ApiResponse<{ token: string }>>('/admin/login', {
    username,
    password,
  });
  return res.data.data.token;
}

/** 获取全部工具列表（含禁用，管理端） */
export async function getAllTools(): Promise<Tool[]> {
  const res = await http.get<ApiResponse<Tool[]>>('/admin/tools');
  return res.data.data ?? [];
}

/** 更新工具启用状态 */
export async function updateToolEnabled(id: string, enabled: boolean): Promise<Tool> {
  const res = await http.patch<ApiResponse<Tool>>(`/admin/tools/${id}`, { enabled });
  return res.data.data;
}

/** 获取三类模型配置（api_key 脱敏） */
export async function getModelConfigs(): Promise<ModelConfig[]> {
  const res = await http.get<ApiResponse<ModelConfig[]>>('/admin/model-configs');
  return res.data.data ?? [];
}

/** 保存模型配置的请求体 */
export interface SaveModelConfigPayload {
  base_url: string;
  /**
   * 留空（null）表示不传该字段，后端保持原密钥不变；
   * 输入新值时才携带，避免误清空
   */
  api_key?: string;
  models: string[];
}

/** 保存某类模型配置 */
export async function saveModelConfig(
  type: ModelType,
  payload: SaveModelConfigPayload,
): Promise<ModelConfig> {
  const res = await http.put<ApiResponse<ModelConfig>>(`/admin/model-configs/${type}`, payload);
  return res.data.data;
}
