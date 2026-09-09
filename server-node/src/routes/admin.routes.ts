import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { login } from '../services/admin.service.js';
import { listAllTools, updateToolEnabled } from '../services/tools.service.js';
import {
  isModelType,
  listModelConfigs,
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

/** 模型配置列表：三类（llm / image-gen / dify），api_key 脱敏，未配置返回 null */
adminRouter.get('/api/admin/model-configs', requireAdmin, (_req, res) => {
  sendOk(res, listModelConfigs());
});

/** 保存/更新某类模型配置：api_key AES-256-GCM 加密落盘 */
adminRouter.put('/api/admin/model-configs/:type', requireAdmin, (req, res) => {
  const { type } = req.params;
  if (!isModelType(type)) {
    throw new ApiError(400, 'INVALID_MODEL_TYPE', `模型类型无效：${type}（允许 llm / image-gen / dify）`);
  }
  const body = req.body ?? {};
  const input: SaveModelConfigInput = {};
  if ('base_url' in body) input.base_url = typeof body.base_url === 'string' ? body.base_url : null;
  if ('api_key' in body) input.api_key = typeof body.api_key === 'string' && body.api_key ? body.api_key : null;
  if ('models' in body) {
    if (!Array.isArray(body.models)) {
      throw new ApiError(400, 'BAD_REQUEST', 'models 必须为字符串数组');
    }
    input.models = body.models.map(String);
  }
  const saved = saveModelConfig(type, input);
  sendOk(res, saved, '保存成功');
});
