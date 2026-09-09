import { Router } from 'express';
import { sendOk } from '../utils/response.js';

/** 健康检查：GET /api/health */
export const healthRouter = Router();

healthRouter.get('/api/health', (_req, res) => {
  sendOk(res, { status: 'up', time: new Date().toISOString() });
});
