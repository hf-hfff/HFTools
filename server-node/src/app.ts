import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { CORS_ORIGIN } from './config.js';
import { healthRouter } from './routes/health.js';
import { toolsRouter } from './routes/tools.js';
import { adminRouter } from './routes/admin.routes.js';
import { aiRouter } from './routes/ai.js';
import { redrawRouter } from './routes/redraw.routes.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

/** 静态资源根目录（熊猫动图等，兼容本地 tsx 与 Docker /app/dist） */
const ASSETS_ROOT = fileURLToPath(new URL('../assets', import.meta.url));

/** 组装 Express 应用：中间件 -> 路由 -> 404 -> 全局错误处理 */
export function createApp(): express.Express {
  const app = express();

  app.use(cors({ origin: CORS_ORIGIN }));
  // 照片点评/照片AI优化/影像重绘统一允许 20MB 原图；20MB → base64 约 27MB，加提示词后 body 上限取 30mb
  app.use('/api/ai/photo-review', express.json({ limit: '30mb' }));
  app.use('/api/ai/photo-optimize', express.json({ limit: '30mb' }));
  app.use('/api/ai/image-redraw', express.json({ limit: '30mb' }));
  // 模板示例图走 base64 上传（单张 5MB → 约 6.7MB）
  app.use('/api/redraw/templates', express.json({ limit: '12mb' }));
  app.use(express.json());

  // 静态资源（/static/photo-review/*.gif）
  app.use('/static', express.static(ASSETS_ROOT));

  app.use(healthRouter, toolsRouter, adminRouter, redrawRouter, aiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
