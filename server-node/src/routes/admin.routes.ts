import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { login } from '../services/admin.service.js';
import { listAllTools, updateToolEnabled } from '../services/tools.service.js';
import {
  getDecryptedConfig,
  isModelType,
  listModelConfigs,
  saveModelConfig,
  type SaveModelConfigInput,
} from '../services/model-configs.service.js';
import { generateImageWithResponsesApi } from '../services/responses-image.client.js';
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
  // image_model 仅 image-gen 生效（非密钥明文字段），其余类型忽略该字段保持原语义
  if (type === 'image-gen' && 'image_model' in body) {
    if (body.image_model !== null && typeof body.image_model !== 'string') {
      throw new ApiError(400, 'BAD_REQUEST', 'image_model 必须为字符串或 null');
    }
    input.image_model = typeof body.image_model === 'string' ? body.image_model : null;
  }
  const saved = saveModelConfig(type, input);
  sendOk(res, saved, '保存成功');
});

/** 能力测试内置图：1x1 白色 PNG data URL（最小载荷，仅用于连通性测试，不落盘不记录） */
const TEST_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';

/** 能力测试超时（短超时快速失败，不自动重试） */
const TEST_TIMEOUT_MS = 60_000;

/**
 * Responses 能力测试：用已保存的 image-gen 配置打一次微型真实请求验证完整链路
 * （/v1/responses + 图片输入 + SSE + image_generation tool）
 * 成功回 { ok: true }；失败由 adapter 归类的 ApiError 原样透出（错误详情已脱敏）
 */
adminRouter.post('/api/admin/model-configs/test-responses', requireAdmin, async (_req, res, next) => {
  try {
    const config = getDecryptedConfig('image-gen');
    if (!config?.base_url || !config.api_key) {
      throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务（image-gen）尚未配置，请先在管理平台完成配置');
    }
    const model = config.models[0] ?? '';
    if (!model) {
      throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务（image-gen）未填模型名称（models），请先在管理平台完成配置');
    }
    await generateImageWithResponsesApi({
      baseUrl: config.base_url,
      apiKey: config.api_key,
      model,
      ...(config.image_model ? { imageModel: config.image_model } : {}),
      image: TEST_IMAGE_DATA_URL,
      prompt: '生成一个纯色圆形用于连通性测试',
      timeoutMs: TEST_TIMEOUT_MS,
    });
    sendOk(res, { ok: true }, 'Responses 能力测试通过');
  } catch (err) {
    next(err);
  }
});
