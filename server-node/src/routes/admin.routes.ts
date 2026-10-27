import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { login } from '../services/admin.service.js';
import { listAllTools, updateToolEnabled } from '../services/tools.service.js';
import {
  assertHttpUrl,
  fetchUpstreamModels,
  getModelConfig,
  isReasoningEffort,
  normalizeOptionalText,
  saveModelConfig,
  type SaveModelConfigInput,
} from '../services/model-configs.service.js';
import { ApiError, sendOk } from '../utils/response.js';

/** 管理平台接口：/api/admin/*（login 之外均需 JWT） */
export const adminRouter = Router();

/** 管理员登录 */
adminRouter.post('/api/admin/login', (req, res) => {
  const body = req.body ?? {};
  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new ApiError(400, 'BAD_REQUEST', '用户名与密码不能为空');
  }
  sendOk(res, login(username, password), '登录成功');
});

/** 工具列表（含禁用的全部工具） */
adminRouter.get('/api/admin/tools', requireAdmin, (_req, res) => {
  sendOk(res, listAllTools());
});

/** 更新工具启用状态 */
adminRouter.patch('/api/admin/tools/:id', requireAdmin, (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    throw new ApiError(400, 'BAD_REQUEST', 'enabled 必须为布尔值');
  }
  const updated = updateToolEnabled(req.params.id, enabled);
  if (!updated) {
    throw new ApiError(404, 'TOOL_NOT_FOUND', '工具不存在');
  }
  sendOk(res, updated, '更新成功');
});

/** 模型配置（单对象）：api_key 脱敏；image_model 为 null 表示跟随系统默认 */
adminRouter.get('/api/admin/model-config', requireAdmin, (_req, res) => {
  sendOk(res, getModelConfig());
});

/**
 * 保存模型配置（单对象 upsert）
 * - api_key 未提供则保持原值；传空串/null 即清空
 * - image_model 传空串/null 即清空（运行时回退默认生图模型）
 * - base_url 仅做格式校验，不发起任何上游请求（不做保存前验证）
 */
adminRouter.put('/api/admin/model-config', requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const input: SaveModelConfigInput = {};

  if ('base_url' in body) {
    const baseUrl = normalizeOptionalText(body.base_url, 'base_url');
    input.base_url = baseUrl ? assertHttpUrl(baseUrl) : null;
  }
  if ('api_key' in body) {
    if (body.api_key !== null && typeof body.api_key !== 'string') {
      throw new ApiError(400, 'BAD_REQUEST', 'api_key 必须为字符串或 null');
    }
    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    input.api_key = rawKey || null;
  }
  if ('default_model' in body) {
    input.default_model = normalizeOptionalText(body.default_model, 'default_model');
  }
  if ('image_model' in body) {
    input.image_model = normalizeOptionalText(body.image_model, 'image_model');
  }
  if ('reasoning_effort' in body) {
    if (!isReasoningEffort(body.reasoning_effort)) {
      throw new ApiError(400, 'INVALID_REASONING_EFFORT', '推理强度只能是 low / medium / high');
    }
    input.reasoning_effort = body.reasoning_effort;
  }

  sendOk(res, saveModelConfig(input), '保存成功');
});

/**
 * 拉取上游模型列表：只使用已保存的配置（不接受请求体传 URL/key，规避 SSRF）
 * 结果不落库、不缓存，仅本次响应返回
 */
adminRouter.post('/api/admin/model-config/models', requireAdmin, async (_req, res, next) => {
  try {
    sendOk(res, await fetchUpstreamModels(), '拉取成功');
  } catch (err) {
    next(err);
  }
});
