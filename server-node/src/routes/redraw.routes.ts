import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { ApiError, sendOk } from '../utils/response.js';
import { resolveDataPath } from '../services/file-store.js';
import {
  addPreview,
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  removePreview,
  updateTemplate,
} from '../services/redraw-templates.service.js';
import {
  clearHistory,
  deleteHistory,
  getHistory,
  listHistory,
} from '../services/redraw-history.service.js';

/**
 * 影像 AI 重绘的模板 / 历史 / 图片读取路由（公开，无鉴权）
 * 无鉴权的写接口是本地单机形态下的明确取舍：禁止把 3001 端口暴露到公网
 */

export const redrawRouter = Router();

/** 允许读取的图片子目录（白名单，与 file-store 的落盘目录一致） */
const FILE_KINDS = new Set(['previews', 'history']);

/** 文件名白名单：只允许字母数字与 . _ -，天然阻断 ../ 穿越 */
const FILE_NAME_RE = /^[A-Za-z0-9._-]+$/;

/* ===== 模板 ===== */

redrawRouter.get('/api/redraw/templates', (_req, res) => {
  sendOk(res, listTemplates());
});

redrawRouter.get('/api/redraw/templates/:id', (req, res) => {
  sendOk(res, getTemplate(req.params.id));
});

redrawRouter.post('/api/redraw/templates', (req, res) => {
  sendOk(res, createTemplate(req.body));
});

redrawRouter.patch('/api/redraw/templates/:id', (req, res) => {
  sendOk(res, updateTemplate(req.params.id, req.body));
});

redrawRouter.delete('/api/redraw/templates/:id', async (req, res, next) => {
  try {
    await deleteTemplate(req.params.id);
    sendOk(res, null);
  } catch (err) {
    next(err);
  }
});

redrawRouter.post('/api/redraw/templates/:id/previews', async (req, res, next) => {
  try {
    const { image } = (req.body ?? {}) as { image?: unknown };
    const detail = await addPreview(req.params.id, image);
    sendOk(res, detail);
  } catch (err) {
    next(err);
  }
});

redrawRouter.delete('/api/redraw/templates/:id/previews/:previewId', async (req, res, next) => {
  try {
    const detail = await removePreview(req.params.id, req.params.previewId);
    sendOk(res, detail);
  } catch (err) {
    next(err);
  }
});

/* ===== 历史记录 ===== */

redrawRouter.get('/api/redraw/history', (req, res) => {
  sendOk(res, listHistory(req.query.page, req.query.size));
});

redrawRouter.get('/api/redraw/history/:id', (req, res) => {
  sendOk(res, getHistory(req.params.id));
});

redrawRouter.delete('/api/redraw/history/:id', async (req, res, next) => {
  try {
    await deleteHistory(req.params.id);
    sendOk(res, null);
  } catch (err) {
    next(err);
  }
});

redrawRouter.delete('/api/redraw/history', async (_req, res, next) => {
  try {
    const removed = await clearHistory();
    sendOk(res, { removed });
  } catch (err) {
    next(err);
  }
});

/* ===== 图片读取（只读，长缓存） ===== */

redrawRouter.get('/api/redraw/files/:kind/:name', (req, res, next) => {
  try {
    const { kind, name } = req.params;
    if (!FILE_KINDS.has(kind) || !FILE_NAME_RE.test(name)) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '文件不存在');
    }
    // resolveDataPath 内部再校验一次绝对路径前缀，双层防护路径穿越
    const abs = resolveDataPath(`redraw/${kind}/${name}`);
    if (!fs.existsSync(abs)) {
      throw new ApiError(404, 'FILE_NOT_FOUND', '文件不存在');
    }
    res.setHeader('Content-Type', `image/${path.extname(abs).slice(1).replace('jpg', 'jpeg')}`);
    // 文件名含随机串且内容一次写定，可长缓存（历史列表重复加载显著受益）
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(abs);
  } catch (err) {
    next(err);
  }
});
