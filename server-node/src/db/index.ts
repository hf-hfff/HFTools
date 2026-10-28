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

/** 旧配置表结构（迁移读取用，字段与历史版本一致） */
interface LegacyModelConfigRow {
  type: string;
  base_url: string | null;
  api_key: string | null;
  models: string | null;
  image_model: string | null;
  updated_at: string | null;
}

/**
 * 幂等建表：启动时自动执行，已存在则跳过
 * - tools         工具注册表（前端显隐由 enabled 控制）
 * - model_config  模型配置（单行 id=1，api_key 密文落盘）
 * - model_configs 旧版配置表（v2 起只读保留，供追溯与回滚）
 * - admin_users   管理员账号（密码 bcrypt 哈希）
 * - redraw_*      影像 AI 重绘（模板 / 模板示例图 / 历史记录）；图片落盘，库内只存相对路径
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
      image_model TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS redraw_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_redraw_templates_name ON redraw_templates(name);

    CREATE TABLE IF NOT EXISTS redraw_template_previews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_redraw_previews_tpl ON redraw_template_previews(template_id);

    CREATE TABLE IF NOT EXISTS redraw_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL,
      result_path TEXT NOT NULL,
      prompt TEXT NOT NULL,
      template_id INTEGER,
      source_bytes INTEGER NOT NULL DEFAULT 0,
      result_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_redraw_history_created ON redraw_history(created_at DESC);
  `);

  // 幂等迁移：旧库补 image_model 列（image-gen 可选扩展字段，明文非密钥）
  const legacyCols = db.prepare('PRAGMA table_info(model_configs)').all() as Array<{ name: string }>;
  if (!legacyCols.some((col) => col.name === 'image_model')) {
    db.exec('ALTER TABLE model_configs ADD COLUMN image_model TEXT');
  }

  migrateModelConfigV2();
}

/**
 * v2 配置表与一次性迁移：
 * 旧表 llm / image-gen 两行合并为单行；api_key 密文直搬（不解密重加密）；
 * dify 行删除前记录摘要（不含 key）；旧表保留只读，用于追溯。
 * 版本标记用 SQLite 原生 PRAGMA user_version，避免额外元数据表。
 */
function migrateModelConfigV2(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL DEFAULT 'openai',
      base_url TEXT,
      api_key TEXT,
      default_model TEXT,
      image_model TEXT,
      reasoning_effort TEXT,
      updated_at TEXT
    );
  `);

  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version >= 1) return;

  const readLegacy = (type: string): LegacyModelConfigRow | undefined =>
    db.prepare('SELECT * FROM model_configs WHERE type = ?').get(type) as
      | LegacyModelConfigRow
      | undefined;

  const migrate = db.transaction(() => {
    const llm = readLegacy('llm');
    const imageGen = readLegacy('image-gen');
    const primary = llm ?? imageGen;

    // 默认模型：优先 llm 首个模型，其次 image-gen 首个模型
    const defaultModel = firstModel(llm?.models) ?? firstModel(imageGen?.models) ?? null;
    const imageModel = imageGen?.image_model?.trim() || null;

    db.prepare(
      `INSERT INTO model_config
         (id, provider, base_url, api_key, default_model, image_model, reasoning_effort, updated_at)
       VALUES (1, 'openai', ?, ?, ?, ?, 'medium', ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(
      primary?.base_url ?? null,
      // 密文直搬：即使 SECRET_KEY 变更导致无法解密，也不阻断迁移
      llm?.api_key ?? imageGen?.api_key ?? null,
      defaultModel,
      imageModel,
      new Date().toISOString(),
    );

    // 旧 image-gen 的驱动模型与新的默认模型不一致时只提示，不自动猜测
    const legacyImageDriver = firstModel(imageGen?.models);
    if (legacyImageDriver && defaultModel && legacyImageDriver !== defaultModel) {
      console.log(
        `[migrate] 旧 image-gen 模型（${legacyImageDriver}）与新默认模型（${defaultModel}）不同，请人工确认`,
      );
    }

    // dify 配置彻底删除：先落摘要日志（不含 api_key）
    const dify = readLegacy('dify');
    if (dify) {
      console.log(
        `[migrate] 删除 dify 配置：base_url=${dify.base_url ?? 'null'} models=${dify.models ?? '[]'} updated_at=${dify.updated_at ?? 'null'}`,
      );
      db.prepare("DELETE FROM model_configs WHERE type = 'dify'").run();
    }

    db.pragma('user_version = 1');
    console.log(
      `[migrate] model_config v2 完成：default_model=${defaultModel ?? 'null'} image_model=${imageModel ?? 'null'}`,
    );
  });

  migrate();
}

/** 解析旧表 models JSON 数组并取首个非空值 */
function firstModel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    for (const item of parsed) {
      const value = String(item).trim();
      if (value) return value;
    }
    return null;
  } catch {
    return null;
  }
}
