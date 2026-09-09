import { db } from '../db/index.js';
import { decrypt, encrypt, maskApiKey } from './crypto.js';

/** 支持的模型配置类型 */
export const MODEL_TYPES = ['llm', 'image-gen', 'dify'] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

export function isModelType(value: string): value is ModelType {
  return (MODEL_TYPES as readonly string[]).includes(value);
}

/** 模型配置接口对象（api_key 已脱敏） */
export interface ModelConfig {
  type: ModelType;
  base_url: string | null;
  api_key: string | null;
  models: string[];
  updated_at: string | null;
}

interface ModelConfigRow {
  type: string;
  base_url: string | null;
  api_key: string | null;
  models: string | null;
  updated_at: string | null;
}

function toConfig(row: ModelConfigRow | undefined, type: ModelType): ModelConfig {
  if (!row) {
    return { type, base_url: null, api_key: null, models: [], updated_at: null };
  }
  let models: string[] = [];
  try {
    const parsed = JSON.parse(row.models ?? '[]');
    if (Array.isArray(parsed)) models = parsed.map(String);
  } catch {
    models = [];
  }
  let maskedKey: string | null = null;
  if (row.api_key) {
    try {
      maskedKey = maskApiKey(decrypt(row.api_key));
    } catch {
      // 密文损坏（如更换过 SECRET_KEY）时降级为打码占位
      maskedKey = '****';
    }
  }
  return { type, base_url: row.base_url, api_key: maskedKey, models, updated_at: row.updated_at };
}

/** 查询全部三类配置（含未配置项），api_key 脱敏返回 */
export function listModelConfigs(): ModelConfig[] {
  const stmt = db.prepare('SELECT * FROM model_configs WHERE type = ?');
  return MODEL_TYPES.map((type) => {
    const row = stmt.get(type) as ModelConfigRow | undefined;
    return toConfig(row, type);
  });
}

/** 内部使用：读取某类配置并解密 api_key；不存在返回 null */
export function getDecryptedConfig(
  type: ModelType,
): { base_url: string | null; api_key: string | null; models: string[] } | null {
  const row = db.prepare('SELECT * FROM model_configs WHERE type = ?').get(type) as
    | ModelConfigRow
    | undefined;
  if (!row) return null;
  let models: string[] = [];
  try {
    const parsed = JSON.parse(row.models ?? '[]');
    if (Array.isArray(parsed)) models = parsed.map(String);
  } catch {
    models = [];
  }
  let apiKey: string | null = null;
  if (row.api_key) {
    try {
      apiKey = decrypt(row.api_key);
    } catch {
      apiKey = null;
    }
  }
  return { base_url: row.base_url, api_key: apiKey, models };
}

/** PUT 请求体：三字段均可选，未提供的字段保持不变 */
export interface SaveModelConfigInput {
  base_url?: string | null;
  api_key?: string | null;
  models?: string[];
}

/**
 * 保存/更新某类模型配置（upsert）
 * api_key 仅在请求体显式提供该字段时更新：传字符串则加密落盘，传 null/空串则清空
 */
export function saveModelConfig(type: ModelType, input: SaveModelConfigInput): ModelConfig {
  const existing = db.prepare('SELECT * FROM model_configs WHERE type = ?').get(type) as
    | ModelConfigRow
    | undefined;

  const baseUrl = input.base_url !== undefined ? (input.base_url || null) : existing?.base_url ?? null;
  const models = JSON.stringify(
    input.models !== undefined ? input.models.map(String) : existing ? safeParseModels(existing.models) : [],
  );
  let apiKeyCipher: string | null;
  if ('api_key' in input) {
    apiKeyCipher = input.api_key ? encrypt(input.api_key) : null;
  } else {
    apiKeyCipher = existing?.api_key ?? null;
  }
  const updatedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO model_configs (type, base_url, api_key, models, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(type) DO UPDATE SET
       base_url = excluded.base_url,
       api_key = excluded.api_key,
       models = excluded.models,
       updated_at = excluded.updated_at`,
  ).run(type, baseUrl, apiKeyCipher, models, updatedAt);

  const saved = db.prepare('SELECT * FROM model_configs WHERE type = ?').get(type) as
    | ModelConfigRow
    | undefined;
  return toConfig(saved, type);
}

function safeParseModels(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
