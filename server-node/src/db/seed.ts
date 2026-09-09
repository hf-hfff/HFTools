import bcrypt from 'bcrypt';
import { db } from './index.js';

/**
 * 工具种子数据：10 个工具按规划顺序注册
 * route 为前端路由路径；icon 使用 emoji 字符串，前端可直接渲染
 */
const TOOL_SEEDS: ReadonlyArray<{
  id: string;
  name: string;
  category: string;
  icon: string;
}> = [
  { id: 'photo-review', name: '照片点评', category: 'photography', icon: '📷' },
  { id: 'photo-enhance', name: '照片AI优化', category: 'photography', icon: '🖌️' },
  { id: 'gear-params', name: '摄影器材参数', category: 'photography', icon: '🎒' },
  { id: 'photo-basics', name: '摄影基础知识', category: 'photography', icon: '📚' },
  { id: 'prompt-engineering', name: '提示词工程', category: 'ai-eng', icon: '⌨️' },
  { id: 'ai-tools', name: 'AI工具下载/介绍', category: 'ai-eng', icon: '🤖' },
  { id: 'git-trending', name: 'git热点追踪', category: 'ai-eng', icon: '🔥' },
  { id: 'jd-analysis', name: 'JD拆解', category: 'job', icon: '📋' },
  { id: 'resume-optimize', name: '简历优化', category: 'job', icon: '📄' },
  { id: 'company-research', name: '公司背调', category: 'job', icon: '🏢' },
];

/**
 * 写入工具种子数据：幂等（按主键 id 忽略已存在记录）
 * 全部 enabled=1、status='placeholder'、sort_order 按数组顺序 1-10
 */
export function seedTools(): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO tools (id, name, category, route, icon, enabled, status, sort_order)
     VALUES (?, ?, ?, ?, ?, 1, 'placeholder', ?)`,
  );
  const run = db.transaction(() => {
    TOOL_SEEDS.forEach((tool, index) => {
      stmt.run(tool.id, tool.name, tool.category, `/tools/${tool.id}`, tool.icon, index + 1);
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
