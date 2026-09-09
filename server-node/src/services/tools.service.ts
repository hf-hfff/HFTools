import { db } from '../db/index.js';

/** 工具元数据（对外接口统一转换为 enabled 布尔值） */
export interface Tool {
  id: string;
  name: string;
  category: string;
  route: string;
  icon: string;
  enabled: boolean;
  status: string;
  sort_order: number;
}

interface ToolRow {
  id: string;
  name: string;
  category: string;
  route: string;
  icon: string;
  enabled: number;
  status: string;
  sort_order: number;
}

/** 数据库行 -> 接口对象 */
function toTool(row: ToolRow): Tool {
  return { ...row, enabled: row.enabled === 1 };
}

/** 全部工具（管理端），按 sort_order 升序 */
export function listAllTools(): Tool[] {
  const rows = db
    .prepare('SELECT * FROM tools ORDER BY sort_order ASC')
    .all() as unknown as ToolRow[];
  return rows.map(toTool);
}

/** 仅启用的工具（用户端公开接口） */
export function listEnabledTools(): Tool[] {
  const rows = db
    .prepare('SELECT * FROM tools WHERE enabled = 1 ORDER BY sort_order ASC')
    .all() as unknown as ToolRow[];
  return rows.map(toTool);
}

/** 按主键查询工具 */
export function getTool(id: string): Tool | null {
  const row = db.prepare('SELECT * FROM tools WHERE id = ?').get(id) as
    | ToolRow
    | undefined;
  return row ? toTool(row) : null;
}

/** 更新工具启用状态，返回更新后的工具；工具不存在返回 null */
export function updateToolEnabled(id: string, enabled: boolean): Tool | null {
  const result = db.prepare('UPDATE tools SET enabled = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    id,
  );
  if (result.changes === 0) return null;
  return getTool(id);
}
