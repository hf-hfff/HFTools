import { Router } from 'express';
import { getDecryptedConfig, type ModelType } from '../services/model-configs.service.js';
import { ApiError } from '../utils/response.js';

/**
 * AI 调用代理层（预留）：POST /api/ai/:task
 * 本期仅校验对应模型配置是否就绪，不实现真实调用
 */

/** task -> 模型配置类型映射：未列出的 task 默认使用 llm */
const TASK_CONFIG_TYPE: Record<string, ModelType> = {
  'git-trending': 'dify',
  'company-research': 'dify',
};

export const aiRouter = Router();

aiRouter.post('/api/ai/:task', (req, res) => {
  const { task } = req.params;
  const type = TASK_CONFIG_TYPE[task] ?? 'llm';
  const config = getDecryptedConfig(type);
  if (!config || !config.api_key) {
    throw new ApiError(
      400,
      'MODEL_NOT_CONFIGURED',
      `模型服务（${type}）尚未配置，请先在管理平台完成配置`,
    );
  }
  // 配置就绪：本期不实现真实调用，返回 501
  throw new ApiError(
    501,
    'NOT_IMPLEMENTED',
    `AI 调用代理（${task}）暂未实现，模型配置（${type}）已就绪`,
  );
});
