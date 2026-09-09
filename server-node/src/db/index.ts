import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 数据目录：<server-node>/data，不存在时自动创建 */
const dataDir = path.resolve(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

/** SQLite 数据库连接（单例） */
export const db = new Database(path.join(dataDir, 'hftools.db'));

/**
 * 幂等建表：启动时自动执行，已存在则跳过
 * - tools         工具注册表（前端显隐由 enabled 控制）
 * - model_configs 模型配置（api_key 密文落盘）
 * - admin_users   管理员账号（密码 bcrypt 哈希）
 */
export function initTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      route TEXT NOT NULL,
      icon TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'placeholder',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS model_configs (
      type TEXT PRIMARY KEY,
      base_url TEXT,
      api_key TEXT,
      models TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
  `);
}
