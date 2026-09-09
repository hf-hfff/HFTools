import express from 'express';
import cors from 'cors';
import { CORS_ORIGIN } from './config.js';
import { healthRouter } from './routes/health.js';
import { toolsRouter } from './routes/tools.js';
import { adminRouter } from './routes/admin.routes.js';
import { aiRouter } from './routes/ai.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

/** 组装 Express 应用：中间件 -> 路由 -> 404 -> 全局错误处理 */
export function createApp(): express.Express {
  const app = express();

  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(express.json());

  app.use(healthRouter, toolsRouter, adminRouter, aiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
