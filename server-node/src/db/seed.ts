import bcrypt from 'bcrypt';
import { db } from './index.js';

/**
 * 工具种子数据：10 个工具按规划顺序注册
 * route 为前端路由路径；icon 存 Element Plus 图标名（kebab-case，前端 ToolIcon 组件渲染）
 * status 为工具当前状态（active=已上线 / placeholder=开发中），种子变更时对已有记录做幂等同步
 */
const TOOL_SEEDS: ReadonlyArray<{
  id: string;
  name: string;
  category: string;
  icon: string;
  status: string;
}> = [
  { id: 'photo-review', name: '照片点评', category: 'photography', icon: 'camera', status: 'active' },
  { id: 'photo-enhance', name: '照片AI优化', category: 'photography', icon: 'magic-stick', status: 'placeholder' },
  { id: 'gear-params', name: '摄影器材参数', category: 'photography', icon: 'suitcase', status: 'placeholder' },
  { id: 'photo-basics', name: '摄影基础知识', category: 'photography', icon: 'reading', status: 'placeholder' },
  { id: 'prompt-engineering', name: '提示词工程', category: 'ai-eng', icon: 'edit-pen', status: 'placeholder' },
  { id: 'ai-tools', name: 'AI工具下载/介绍', category: 'ai-eng', icon: 'cpu', status: 'placeholder' },
  { id: 'git-trending', name: 'git热点追踪', category: 'ai-eng', icon: 'trend-charts', status: 'placeholder' },
  { id: 'jd-analysis', name: 'JD拆解', category: 'job', icon: 'tickets', status: 'placeholder' },
  { id: 'resume-optimize', name: '简历优化', category: 'job', icon: 'document-checked', status: 'placeholder' },
  { id: 'company-research', name: '公司背调', category: 'job', icon: 'office-building', status: 'placeholder' },
];

/**
 * 写入工具种子数据：幂等（按主键 id 忽略已存在记录）
 * enabled=1、sort_order 按数组顺序 1-10；status / icon 以种子为准做幂等同步
 * （INSERT OR IGNORE 不会更新已有记录，placeholder→active 上线、emoji→图标名迁移均需显式 UPDATE）
 */
export function seedTools(): void {
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO tools (id, name, category, route, icon, enabled, status, sort_order)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const updateStatusStmt = db.prepare(
    `UPDATE tools SET status = ? WHERE id = ? AND status <> ?`,
  );
  const updateIconStmt = db.prepare(
    `UPDATE tools SET icon = ? WHERE id = ? AND icon <> ?`,
  );
  const run = db.transaction(() => {
    TOOL_SEEDS.forEach((tool, index) => {
      insertStmt.run(tool.id, tool.name, tool.category, `/tools/${tool.id}`, tool.icon, tool.status, index + 1);
      updateStatusStmt.run(tool.status, tool.id, tool.status);
      updateIconStmt.run(tool.icon, tool.id, tool.icon);
    });
  });
  run();
}

/** 首次启动若无管理员则创建默认账号 admin / admin123 */
export function seedAdminUser(): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get() as { n: number };
  if (row.n > 0) return;
  const passwordHash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(
    'admin',
    passwordHash,
  );
  console.log('[seed] 已创建默认管理员账号：admin（密码 admin123）');
}
