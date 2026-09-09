import type { Response } from 'express';

/**
 * 业务错误：携带 HTTP 状态码与业务 code
 * 路由/中间件中直接 throw，由全局错误处理中间件统一转换为响应
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 统一成功响应：{ code, message, data } */
export function sendOk(res: Response, data: unknown = null, message = 'ok'): void {
  res.status(200).json({ code: 'OK', message, data });
}
