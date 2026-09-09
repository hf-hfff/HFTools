import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config.js';
import { ApiError } from '../utils/response.js';

/** JWT 中携带的管理员信息 */
export interface AdminPayload {
  sub: number;
  username: string;
  role: string;
}

/**
 * JWT 校验中间件：保护 /api/admin/* 管理接口
 * 校验通过后将管理员信息挂载到 req.admin
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    throw new ApiError(401, 'UNAUTHORIZED', '未登录或缺少访问令牌');
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as AdminPayload;
    (req as Request & { admin?: AdminPayload }).admin = payload;
    next();
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', '访问令牌无效或已过期');
  }
}
