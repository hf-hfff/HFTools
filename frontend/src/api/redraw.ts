import { http } from './http';
import type { ApiResponse } from '@/types';

/** 模板示例图（id 用于删除，url 用于渲染） */
export interface TemplatePreview {
  id: number;
  url: string;
}

/** 模板列表项（不含正文，弹窗展示与检索用） */
export interface TemplateListItem {
  id: number;
  name: string;
  previews: TemplatePreview[];
}

/** 模板详情（含正文） */
export interface TemplateDetail extends TemplateListItem {
  body: string;
}

/** 重绘结果：图片为同源 URL，history_id 为 null 表示历史写入失败（结果图仍可用） */
export interface RedrawResult {
  history_id: number | null;
  source_url: string;
  result_url: string;
  prompt: string;
}

/** 历史记录项 */
export interface HistoryItem {
  id: number;
  source_url: string;
  result_url: string;
  prompt: string;
  template_id: number | null;
  created_at: string;
}

/** 历史分页结果 */
export interface HistoryPage {
  items: HistoryItem[];
  total: number;
  page: number;
  size: number;
}

/** 模板列表 */
export async function listTemplates(): Promise<TemplateListItem[]> {
  const res = await http.get<ApiResponse<TemplateListItem[]>>('/redraw/templates');
  return res.data.data;
}

/** 模板详情 */
export async function getTemplate(id: number): Promise<TemplateDetail> {
  const res = await http.get<ApiResponse<TemplateDetail>>(`/redraw/templates/${id}`);
  return res.data.data;
}

/** 新建模板 */
export async function createTemplate(params: {
  name: string;
  body: string;
}): Promise<TemplateDetail> {
  const res = await http.post<ApiResponse<TemplateDetail>>('/redraw/templates', params);
  return res.data.data;
}

/** 更新模板（名称 / 正文） */
export async function updateTemplate(
  id: number,
  params: Partial<{ name: string; body: string }>,
): Promise<TemplateDetail> {
  const res = await http.patch<ApiResponse<TemplateDetail>>(`/redraw/templates/${id}`, params);
  return res.data.data;
}

/** 删除模板（含示例图文件） */
export async function deleteTemplate(id: number): Promise<void> {
  await http.delete(`/redraw/templates/${id}`);
}

/** 上传示例图（base64 data URL，单模板最多 3 张） */
export async function addTemplatePreview(id: number, image: string): Promise<TemplateDetail> {
  const res = await http.post<ApiResponse<TemplateDetail>>(`/redraw/templates/${id}/previews`, {
    image,
  });
  return res.data.data;
}

/** 删除示例图 */
export async function removeTemplatePreview(
  id: number,
  previewId: number,
): Promise<TemplateDetail> {
  const res = await http.delete<ApiResponse<TemplateDetail>>(
    `/redraw/templates/${id}/previews/${previewId}`,
  );
  return res.data.data;
}

/** 重绘链路超时（ms）：后端 images/edits 上限 150s + 落盘，须显著大于该值 */
const REDRAW_TIMEOUT_MS = 320_000;

/** 提交重绘：返回图片 URL（非 base64），history_id 可能为 null */
export async function imageRedraw(
  params: { image: string; prompt: string; template_id?: number | null },
  timeoutMs = REDRAW_TIMEOUT_MS,
): Promise<RedrawResult> {
  const res = await http.post<ApiResponse<RedrawResult>>('/ai/image-redraw', params, {
    timeout: timeoutMs,
  });
  return res.data.data;
}

/** 提示词优化超时（ms）：10000 字全文优化最坏接近 3 分钟 */
const OPTIMIZE_TIMEOUT_MS = 180_000;

/** AI 优化提示词（纯文本改写，全量输入不截断） */
export async function optimizeRedrawPrompt(
  prompt: string,
  timeoutMs = OPTIMIZE_TIMEOUT_MS,
): Promise<string> {
  const res = await http.post<ApiResponse<{ result: string }>>(
    '/ai/redraw-prompt-optimize',
    { prompt },
    { timeout: timeoutMs },
  );
  return res.data.data.result;
}

/** 历史列表（分页） */
export async function listHistory(page = 1, size = 20): Promise<HistoryPage> {
  const res = await http.get<ApiResponse<HistoryPage>>('/redraw/history', {
    params: { page, size },
  });
  return res.data.data;
}

/** 删除单条历史（含图片文件） */
export async function deleteHistory(id: number): Promise<void> {
  await http.delete(`/redraw/history/${id}`);
}

/** 清空全部历史 */
export async function clearHistory(): Promise<number> {
  const res = await http.delete<ApiResponse<{ removed: number }>>('/redraw/history');
  return res.data.data.removed;
}
