import { Router } from 'express';
import { getDecryptedConfig, type ModelType } from '../services/model-configs.service.js';
import { reviewPhoto } from '../services/photo-review.service.js';
import { optimizePrompt } from '../services/prompt-optimize.service.js';
import { sendOk, ApiError } from '../utils/response.js';

/**
 * AI 调用代理层：POST /api/ai/:task
 * 具体业务路由（如 photo-review）须注册在通用 :task 之前
 */

/** task -> 模型配置类型映射：未列出的 task 默认使用 llm */
const TASK_CONFIG_TYPE: Record<string, ModelType> = {
  'git-trending': 'dify',
  'company-research': 'dify',
};

export const aiRouter = Router();

/** 照片点评：POST /api/ai/photo-review，body: { image: dataURL, note?: string } */
aiRouter.post('/api/ai/photo-review', async (req, res, next) => {
  try {
    const { image, note } = (req.body ?? {}) as { image?: unknown; note?: unknown };
    const review = await reviewPhoto(image, note);
    sendOk(res, { review });
  } catch (err) {
    // Express 4 不自动捕获 async rejection，需显式交给全局错误处理
    next(err);
  }
});

/** 提示词优化：POST /api/ai/prompt-optimize，body: { prompt, level, scene } */
aiRouter.post('/api/ai/prompt-optimize', async (req, res, next) => {
  try {
    const { prompt, level, scene } = (req.body ?? {}) as {
      prompt?: unknown;
      level?: unknown;
      scene?: unknown;
    };
    const result = await optimizePrompt(prompt, level, scene);
    sendOk(res, { result });
  } catch (err) {
    next(err);
  }
});

/** 通用代理入口（预留）：校验模型配置就绪，未实现真实调用的 task 返回 501 */
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
