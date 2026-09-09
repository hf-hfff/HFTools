/**
 * 服务配置：环境变量优先，默认值仅供本地开发使用
 */

/** 监听端口 */
export const PORT = Number(process.env.PORT) || 3001;

/** JWT 签发密钥 */
export const JWT_SECRET = process.env.JWT_SECRET || 'hftools-local-dev-jwt-secret';

/** API key AES 加密主密钥（派生 32 字节密钥） */
export const SECRET_KEY = process.env.SECRET_KEY || 'hftools-local-dev-secret-key';

/** CORS 允许来源 */
export const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
