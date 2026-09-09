import { createApp } from './app.js';
import { initTables } from './db/index.js';
import { seedAdminUser, seedTools } from './db/seed.js';
import { PORT } from './config.js';

// 初始化数据库：幂等建表 + 种子数据（工具注册 + 默认管理员）
initTables();
seedTools();
seedAdminUser();

// 启动 HTTP 服务
const app = createApp();
app.listen(PORT, () => {
  console.log(`[hftools-server] 网关已启动: http://localhost:${PORT}`);
});
