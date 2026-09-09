import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { JWT_SECRET } from '../config.js';
import { ApiError } from '../utils/response.js';

interface AdminUserRow {
  id: number;
  username: string;
  password_hash: string;
}

/** JWT 有效期 */
const JWT_EXPIRES_IN = '7d';

/** 管理员登录：校验密码并签发 JWT；失败统一返回 401 */
export function login(username: string, password: string): { token: string } {
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username) as
    | AdminUserRow
    | undefined;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new ApiError(401, 'UNAUTHORIZED', '用户名或密码错误');
  }
  const token = jwt.sign(
    { sub: user.id, username: user.username, role: 'admin' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
  return { token };
}
