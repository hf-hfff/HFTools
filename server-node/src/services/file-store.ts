import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../utils/response.js';
import { detectImageMime } from './responses-image.client.js';

/**
 * 重绘图片文件存储：base64 data URL → 校验 → 落盘到 data/redraw/{previews,history}
 * 只写 data/（docker-compose 中唯一持久化卷），库内只存相对路径，容器内外路径才能一致
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 项目数据根目录：<server-node>/data */
export const DATA_DIR = path.resolve(__dirname, '../../data');

/** 重绘图片子目录 */
export type ImageSubdir = 'previews' | 'history';

/** data URL 解析（mime 子类型允许 jpeg/jpg/png/webp，实际以 magic number 为准） */
const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]*)$/i;

/** magic number mime → 落盘扩展名 */
const EXT_BY_MIME: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/** 落盘结果 */
export interface SavedImage {
  /** 相对 data 目录的路径，如 redraw/history/1730-ab12cd34-out.jpg */
  relPath: string;
  bytes: number;
}

/** 落盘校验参数 */
export interface SaveImageOptions {
  /** 解码后最大字节数 */
  maxBytes: number;
  /** 格式非法时的错误码与文案 */
  invalidCode: string;
  invalidMessage: string;
  /** 超出大小上限时的错误码与文案 */
  tooLargeCode: string;
  tooLargeMessage: string;
}

/** 子目录绝对路径，不存在时创建（启动即可用，不依赖额外初始化步骤） */
export function ensureSubdir(subdir: ImageSubdir): string {
  const dir = path.join(DATA_DIR, 'redraw', subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 相对路径 → 绝对路径
 * 必须做穿越校验：`redraw/../../.env` 之类会解析到 data 目录之外，读走 SECRET_KEY
 */
export function resolveDataPath(relPath: string): string {
  const abs = path.resolve(DATA_DIR, relPath);
  if (abs !== DATA_DIR && !abs.startsWith(DATA_DIR + path.sep)) {
    throw new ApiError(400, 'INVALID_FILE_PATH', '非法文件路径');
  }
  return abs;
}

/** 去掉文件基名里的非安全字符，避免路径注入与跨平台差异 */
function sanitizeBaseName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '');
  return safe || randomUUID().slice(0, 8);
}

/** 生成唯一基名（时间戳 + 随机串，避免并发同秒覆盖） */
export function uniqueBaseName(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/**
 * data URL 图片落盘
 * 先校验后写盘：格式（magic number）→ 载荷非空 → 大小上限，任一不符直接抛错，不产生半成品文件
 * @param dataUrl 未信任的 data URL
 * @param subdir 目标子目录
 * @param baseName 文件基名（不含扩展名，会做安全字符过滤）
 * @param options 大小上限与错误码
 */
export async function saveDataUrlImage(
  dataUrl: unknown,
  subdir: ImageSubdir,
  baseName: string,
  options: SaveImageOptions,
): Promise<SavedImage> {
  if (typeof dataUrl !== 'string') {
    throw new ApiError(400, options.invalidCode, options.invalidMessage);
  }
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match || !match[1]) {
    throw new ApiError(400, options.invalidCode, options.invalidMessage);
  }
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length === 0) {
    throw new ApiError(400, options.invalidCode, options.invalidMessage);
  }
  if (buffer.length > options.maxBytes) {
    throw new ApiError(400, options.tooLargeCode, options.tooLargeMessage);
  }
  // 扩展名以解码后的 magic number 为准，不信任前端声明的 MIME
  const mime = detectImageMime(buffer);
  if (!mime) {
    throw new ApiError(400, options.invalidCode, options.invalidMessage);
  }

  const fileName = `${sanitizeBaseName(baseName)}.${EXT_BY_MIME[mime] ?? 'png'}`;
  const dir = ensureSubdir(subdir);
  const abs = path.join(dir, fileName);
  try {
    await fsp.writeFile(abs, buffer);
  } catch (err) {
    console.error(
      '[file-store] 图片落盘失败:',
      err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    );
    throw new ApiError(502, 'IMAGE_STORAGE_FAILED', '图片保存失败，请检查磁盘空间');
  }
  return { relPath: `redraw/${subdir}/${fileName}`, bytes: buffer.length };
}

/** 删除文件：失败只记日志，不阻断调用方（清理流程不能因一个坏文件卡住） */
export async function removeDataFile(relPath: string | null | undefined): Promise<void> {
  if (!relPath) return;
  try {
    await fsp.unlink(resolveDataPath(relPath));
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== 'ENOENT') {
      console.error(
        '[file-store] 删除文件失败:',
        relPath,
        err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      );
    }
  }
}

/**
 * 相对路径 → 前端可访问 URL
 * 文件名唯一且内容一次写定，可长缓存；kind 由路径倒数第二段推导（previews / history）
 */
export function fileUrl(relPath: string): string {
  const parts = relPath.split('/');
  const name = parts[parts.length - 1] ?? '';
  const kind = parts[parts.length - 2] ?? '';
  return `/api/redraw/files/${kind}/${name}`;
}
