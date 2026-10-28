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
  // 照片点评/照片AI优化带 base64 图片，须在全局 json 解析之前按路径放宽 body 上限（express.json 跳过已解析请求）
  app.use('/api/ai/photo-review', express.json({ limit: '12mb' }));
  app.use('/api/ai/photo-optimize', express.json({ limit: '12mb' }));
  // 影像 AI 重绘：原图 8MB → base64 约 10.7MB，加 1 万字提示词后 12mb 足够
  app.use('/api/ai/image-redraw', express.json({ limit: '12mb' }));
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
