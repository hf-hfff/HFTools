import { db } from '../db/index.js';
import { ApiError } from '../utils/response.js';
import { fileUrl, removeDataFile } from './file-store.js';

/**
 * 重绘历史记录：原图 / 结果图 / 最终提交的提示词
 * 图片落盘（库内只存相对路径），并按「100 条 + 2GB」双上限自动清理最旧记录
 */

/** 记录条数上限 */
const HISTORY_MAX_ROWS = 100;

/** 图片总占用上限（2GB） */
const HISTORY_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** 分页默认与上限 */
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

/** 历史行 */
interface HistoryRow {
  id: number;
  source_path: string;
  result_path: string;
  prompt: string;
  template_id: number | null;
  source_bytes: number;
  result_bytes: number;
  created_at: string;
}

/** 历史记录对外结构（图片以 URL 提供，前端 <img> 直接加载） */
export interface HistoryItem {
  id: number;
  source_url: string;
  result_url: string;
  prompt: string;
  template_id: number | null;
  created_at: string;
}

/** 分页结果 */
export interface HistoryPage {
  items: HistoryItem[];
  total: number;
  page: number;
  size: number;
}

/** 行 → 对外结构 */
function toItem(row: HistoryRow): HistoryItem {
  return {
    id: row.id,
    source_url: fileUrl(row.source_path),
    result_url: fileUrl(row.result_path),
    prompt: row.prompt,
    template_id: row.template_id,
    created_at: row.created_at,
  };
}

/** 写入历史参数 */
export interface SaveHistoryInput {
  sourcePath: string;
  resultPath: string;
  prompt: string;
  templateId: number | null;
  sourceBytes: number;
  resultBytes: number;
}

/** 写入一条历史，返回自增 id */
export function saveHistory(input: SaveHistoryInput): number {
  const result = db
    .prepare(
      `INSERT INTO redraw_history
         (source_path, result_path, prompt, template_id, source_bytes, result_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.sourcePath,
      input.resultPath,
      input.prompt,
      input.templateId,
      input.sourceBytes,
      input.resultBytes,
      new Date().toISOString(),
    );
  return Number(result.lastInsertRowid);
}

/** 分页查询（created_at 倒序，同秒用 id 兜底保证稳定） */
export function listHistory(page: unknown, size: unknown): HistoryPage {
  const pageNum = Math.max(1, Math.floor(Number(page)) || 1);
  const sizeNum = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Math.floor(Number(size)) || PAGE_SIZE_DEFAULT),
  );
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM redraw_history').get() as { n: number };
  const rows = db
    .prepare(
      `SELECT * FROM redraw_history
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(sizeNum, (pageNum - 1) * sizeNum) as HistoryRow[];
  return { items: rows.map(toItem), total: n, page: pageNum, size: sizeNum };
}

/** 单条详情；不存在 → HISTORY_NOT_FOUND */
export function getHistory(rawId: unknown): HistoryItem {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, 'HISTORY_NOT_FOUND', '记录不存在');
  }
  const row = db.prepare('SELECT * FROM redraw_history WHERE id = ?').get(id) as
    | HistoryRow
    | undefined;
  if (!row) {
    throw new ApiError(404, 'HISTORY_NOT_FOUND', '记录不存在');
  }
  return toItem(row);
}

/** 删除单条（行 + 两张图） */
export async function deleteHistory(rawId: unknown): Promise<void> {
  const item = getHistory(rawId);
  const row = db.prepare('SELECT source_path, result_path FROM redraw_history WHERE id = ?').get(
    item.id,
  ) as { source_path: string; result_path: string };
  db.prepare('DELETE FROM redraw_history WHERE id = ?').run(item.id);
  await removeDataFile(row.source_path);
  await removeDataFile(row.result_path);
}

/** 清空全部（先删行再逐个删文件，避免中途失败留下孤儿行） */
export async function clearHistory(): Promise<number> {
  const rows = db.prepare('SELECT source_path, result_path FROM redraw_history').all() as Array<{
    source_path: string;
    result_path: string;
  }>;
  db.prepare('DELETE FROM redraw_history').run();
  for (const row of rows) {
    await removeDataFile(row.source_path);
    await removeDataFile(row.result_path);
  }
  return rows.length;
}

/**
 * 容量清理：条数超 100 或总字节超 2GB 时，按时间从旧到新逐条删除
 * 依赖 source_bytes / result_bytes 列，避免每次遍历目录 statSync（代价随记录数线性上升）
 * 删除文件失败只记日志，不阻断行删除（一个坏文件不能卡住整个清理）
 */
export async function enforceCapacity(): Promise<void> {
  const stat = db
    .prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(source_bytes + result_bytes), 0) AS bytes FROM redraw_history',
    )
    .get() as { n: number; bytes: number };

  let count = stat.n;
  let bytes = stat.bytes;
  if (count <= HISTORY_MAX_ROWS && bytes <= HISTORY_MAX_BYTES) return;

  const victims = db
    .prepare(
      `SELECT id, source_path, result_path, source_bytes, result_bytes
       FROM redraw_history ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{
    id: number;
    source_path: string;
    result_path: string;
    source_bytes: number;
    result_bytes: number;
  }>;

  for (const victim of victims) {
    if (count <= HISTORY_MAX_ROWS && bytes <= HISTORY_MAX_BYTES) break;
    db.prepare('DELETE FROM redraw_history WHERE id = ?').run(victim.id);
    await removeDataFile(victim.source_path);
    await removeDataFile(victim.result_path);
    count -= 1;
    bytes -= victim.source_bytes + victim.result_bytes;
  }
  console.log(`[redraw-history] 容量清理完成：剩余 ${count} 条 / ${Math.round(bytes / 1024 / 1024)}MB`);
}
