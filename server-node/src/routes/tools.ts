import { Router } from 'express';
import { listEnabledTools } from '../services/tools.service.js';
import { sendOk } from '../utils/response.js';

/** 用户端工具列表（公开接口）：GET /api/tools 仅返回启用工具 */
export const toolsRouter = Router();

toolsRouter.get('/api/tools', (_req, res) => {
  sendOk(res, listEnabledTools());
});
