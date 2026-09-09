import crypto from 'node:crypto';
import { SECRET_KEY } from '../config.js';

/** 从主密钥派生 32 字节 AES-256 密钥 */
const KEY = crypto.createHash('sha256').update(SECRET_KEY).digest();

/**
 * AES-256-GCM 加密
 * 输出格式：hex(iv):hex(authTag):hex(ciphertext)
 */
export function encrypt(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

/** AES-256-GCM 解密（仅后端内部使用，接口不返回明文） */
export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * API key 脱敏展示：如 sk-abcdef123456 -> sk-****3456
 * 长度不足 8 位时整体打码；空值返回 null
 */
export function maskApiKey(plainKey: string | null): string | null {
  if (!plainKey) return null;
  if (plainKey.length <= 8) return '****';
  return `${plainKey.slice(0, 3)}****${plainKey.slice(-4)}`;
}
