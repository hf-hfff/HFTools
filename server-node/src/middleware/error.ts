import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError } from '../utils/response.js';

/** 404：未匹配到任何路由 */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: `接口不存在：${req.method} ${req.path}`,
    data: null,
  });
};

/**
 * 全局错误处理：统一转换为 { code, message, data }
 * 未知错误只记录服务端日志，不向客户端泄露堆栈与内部细节
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ code: err.code, message: err.message, data: null });
    return;
  }
  console.error(`[error] ${req.method} ${req.path}:`, err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务器内部错误', data: null });
};
