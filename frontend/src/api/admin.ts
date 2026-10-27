import { http } from './http';
import type { ApiResponse, ModelConfig, ReasoningEffort, Tool, UpstreamModel } from '@/types';

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

/** 获取模型配置（单对象，api_key 脱敏） */
export async function getModelConfig(): Promise<ModelConfig> {
  const res = await http.get<ApiResponse<ModelConfig>>('/admin/model-config');
  return res.data.data;
}

/** 保存模型配置的请求体（字段未提供表示保持不变） */
export interface SaveModelConfigPayload {
  base_url: string;
  /** 留空表示不携带该字段，后端保持原密钥不变 */
  api_key?: string;
  default_model: string;
  /** 空串表示清空，运行时回退默认生图模型 */
  image_model: string;
  reasoning_effort: ReasoningEffort;
}

/** 保存模型配置 */
export async function saveModelConfig(payload: SaveModelConfigPayload): Promise<ModelConfig> {
  const res = await http.put<ApiResponse<ModelConfig>>('/admin/model-config', payload);
  return res.data.data;
}

/** 上游模型列表（不缓存，仅本次返回） */
export interface UpstreamModelsResult {
  models: UpstreamModel[];
  total: number;
  fetched_at: string;
}

/** 拉取上游模型列表：仅使用已保存的配置，请求体为空 */
export async function fetchUpstreamModels(): Promise<UpstreamModelsResult> {
  const res = await http.post<ApiResponse<UpstreamModelsResult>>('/admin/model-config/models', {});
  return res.data.data;
}
