import { db } from '../db/index.js';
import { ApiError } from '../utils/response.js';
import {
  fileUrl,
  removeDataFile,
  saveDataUrlImage,
  uniqueBaseName,
  type ImageSubdir,
} from './file-store.js';

/**
 * 重绘提示词模板：极简三字段（id / name / body）+ 示例图子表
 * 不做分类、排序、启用状态、时间字段；名称检索由前端本地模糊过滤（列表不含 body，体积可控）
 */

/** 模板名称长度上限 */
const NAME_MAX = 60;

/** 模板正文长度上限（与重绘提示词上限一致） */
const BODY_MAX = 10_000;

/** 模板总数上限（无鉴权写接口的外部约束） */
const TEMPLATE_MAX = 200;

/** 单模板示例图数量上限 */
const PREVIEW_MAX = 3;

/** 示例图解码后大小上限（5MB） */
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

/** 示例图落盘校验参数 */
const PREVIEW_SAVE_OPTIONS = {
  maxBytes: PREVIEW_MAX_BYTES,
  invalidCode: 'INVALID_PREVIEW_IMAGE',
  invalidMessage: '示例图格式不正确，请上传 jpg/png/webp 图片',
  tooLargeCode: 'PREVIEW_TOO_LARGE',
  tooLargeMessage: '示例图过大（最大 5MB），请压缩后重试',
};

/** 模板主表行 */
interface TemplateRow {
  id: number;
  name: string;
  body: string;
}

/** 列表行（LEFT JOIN 后每张示例图一行，template 字段重复） */
interface TemplateJoinRow {
  id: number;
  name: string;
  pid: number | null;
  path: string | null;
}

/** 模板示例图（id 供删除接口使用，url 供 el-image 渲染） */
export interface TemplatePreview {
  id: number;
  url: string;
}

/** 列表项：不含 body（列表只用于弹窗展示与检索） */
export interface TemplateListItem {
  id: number;
  name: string;
  previews: TemplatePreview[];
}

/** 详情：含正文全文与示例图 URL */
export interface TemplateDetail extends TemplateListItem {
  body: string;
}

/** 解析并校验模板 id（路由参数与入参共用） */
export function parseTemplateId(raw: unknown): number {
  const id = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, 'TEMPLATE_NOT_FOUND', '模板不存在或已删除');
  }
  return id;
}

/** 校验模板名称：trim 后 1–60 字 */
function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'EMPTY_TEMPLATE_NAME', '请填写模板名称');
  }
  const name = raw.trim();
  if (!name) {
    throw new ApiError(400, 'EMPTY_TEMPLATE_NAME', '请填写模板名称');
  }
  if (name.length > NAME_MAX) {
    throw new ApiError(400, 'TEMPLATE_NAME_TOO_LONG', `模板名称过长（最多 ${NAME_MAX} 字）`);
  }
  return name;
}

/** 校验模板正文：trim 后 1–10000 字（空模板选中后等于没选，不允许保存） */
function normalizeBody(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'EMPTY_TEMPLATE_BODY', '模板正文不能为空');
  }
  const body = raw.trim();
  if (!body) {
    throw new ApiError(400, 'EMPTY_TEMPLATE_BODY', '模板正文不能为空');
  }
  if (body.length > BODY_MAX) {
    throw new ApiError(400, 'PROMPT_TOO_LONG', `模板正文过长（最多 ${BODY_MAX} 字）`);
  }
  return body;
}

/** 模板示例图列表（按 seq 升序，转成可访问 URL） */
function listPreviews(templateId: number): TemplatePreview[] {
  const rows = db
    .prepare('SELECT id, path FROM redraw_template_previews WHERE template_id = ? ORDER BY seq ASC, id ASC')
    .all(templateId) as Array<{ id: number; path: string }>;
  return rows.map((row) => ({ id: row.id, url: fileUrl(row.path) }));
}

/** 模板存在性（重绘写历史时校验 template_id 来源用） */
export function templateExists(id: number): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM redraw_templates WHERE id = ?').get(id) as
    | { ok: number }
    | undefined;
  return Boolean(row);
}

/**
 * 模板列表：一次 JOIN 查询 + 内存分组，避免 N+1
 * 按 id 倒序（新建的排在弹窗最前）
 */
export function listTemplates(): TemplateListItem[] {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.name AS name, p.id AS pid, p.path AS path
       FROM redraw_templates t
       LEFT JOIN redraw_template_previews p ON p.template_id = t.id
       ORDER BY t.id DESC, p.seq ASC, p.id ASC`,
    )
    .all() as TemplateJoinRow[];

  const grouped = new Map<number, TemplateListItem>();
  for (const row of rows) {
    let item = grouped.get(row.id);
    if (!item) {
      item = { id: row.id, name: row.name, previews: [] };
      grouped.set(row.id, item);
    }
    // pid 为 null 表示该模板尚无示例图（LEFT JOIN 空行）
    if (row.path && row.pid !== null) item.previews.push({ id: row.pid, url: fileUrl(row.path) });
  }
  return [...grouped.values()];
}

/** 模板详情（含正文）；不存在 → TEMPLATE_NOT_FOUND */
export function getTemplate(rawId: unknown): TemplateDetail {
  const id = parseTemplateId(rawId);
  const row = db.prepare('SELECT id, name, body FROM redraw_templates WHERE id = ?').get(id) as
    | TemplateRow
    | undefined;
  if (!row) {
    throw new ApiError(404, 'TEMPLATE_NOT_FOUND', '模板不存在或已删除');
  }
  return { id: row.id, name: row.name, body: row.body, previews: listPreviews(row.id) };
}

/** 新建模板：名称与正文必填，总数不超过 200 */
export function createTemplate(input: unknown): TemplateDetail {
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const name = normalizeName(body.name);
  const text = normalizeBody(body.body);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM redraw_templates').get() as { n: number };
  if (n >= TEMPLATE_MAX) {
    throw new ApiError(400, 'TEMPLATE_LIMIT_REACHED', `模板数量已达上限（${TEMPLATE_MAX}），请先删除不用的模板`);
  }

  const result = db.prepare('INSERT INTO redraw_templates (name, body) VALUES (?, ?)').run(name, text);
  return getTemplate(Number(result.lastInsertRowid));
}

/** 更新模板：名称与正文均可选，至少提供一项 */
export function updateTemplate(rawId: unknown, input: unknown): TemplateDetail {
  const id = parseTemplateId(rawId);
  const existing = getTemplate(id);
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const hasName = body.name !== undefined;
  const hasBody = body.body !== undefined;
  if (!hasName && !hasBody) {
    throw new ApiError(400, 'EMPTY_TEMPLATE_BODY', '没有需要更新的内容');
  }
  const name = hasName ? normalizeName(body.name) : existing.name;
  const text = hasBody ? normalizeBody(body.body) : existing.body;
  db.prepare('UPDATE redraw_templates SET name = ?, body = ? WHERE id = ?').run(name, text, id);
  return getTemplate(id);
}

/** 删除模板：先清示例图行与文件，再删主表（历史记录保留，template_id 仅作来源标记） */
export async function deleteTemplate(rawId: unknown): Promise<void> {
  const id = parseTemplateId(rawId);
  getTemplate(id);

  const previews = db
    .prepare('SELECT path FROM redraw_template_previews WHERE template_id = ?')
    .all(id) as Array<{ path: string }>;

  db.prepare('DELETE FROM redraw_template_previews WHERE template_id = ?').run(id);
  db.prepare('DELETE FROM redraw_templates WHERE id = ?').run(id);

  for (const preview of previews) {
    await removeDataFile(preview.path);
  }
}

/** 新增示例图：单模板最多 3 张，单张 ≤5MB */
export async function addPreview(rawId: unknown, dataUrl: unknown): Promise<TemplateDetail> {
  const id = parseTemplateId(rawId);
  getTemplate(id);

  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM redraw_template_previews WHERE template_id = ?')
    .get(id) as { n: number };
  if (n >= PREVIEW_MAX) {
    throw new ApiError(400, 'PREVIEW_LIMIT_REACHED', `每个模板最多 ${PREVIEW_MAX} 张示例图`);
  }

  const subdir: ImageSubdir = 'previews';
  const saved = await saveDataUrlImage(dataUrl, subdir, `${id}-${n}-${uniqueBaseName()}`, PREVIEW_SAVE_OPTIONS);
  const { max } = db
    .prepare('SELECT COALESCE(MAX(seq), -1) AS max FROM redraw_template_previews WHERE template_id = ?')
    .get(id) as { max: number };
  db.prepare('INSERT INTO redraw_template_previews (template_id, path, seq) VALUES (?, ?, ?)').run(
    id,
    saved.relPath,
    max + 1,
  );
  return getTemplate(id);
}

/** 删除单张示例图（行 + 文件）；不属于该模板 → PREVIEW_NOT_FOUND */
export async function removePreview(rawId: unknown, rawPreviewId: unknown): Promise<TemplateDetail> {
  const id = parseTemplateId(rawId);
  const previewId = Number(rawPreviewId);
  if (!Number.isInteger(previewId) || previewId <= 0) {
    throw new ApiError(404, 'PREVIEW_NOT_FOUND', '示例图不存在');
  }
  const row = db
    .prepare('SELECT path FROM redraw_template_previews WHERE id = ? AND template_id = ?')
    .get(previewId, id) as { path: string } | undefined;
  if (!row) {
    throw new ApiError(404, 'PREVIEW_NOT_FOUND', '示例图不存在');
  }
  db.prepare('DELETE FROM redraw_template_previews WHERE id = ?').run(previewId);
  await removeDataFile(row.path);
  return getTemplate(id);
}
