import { Router } from 'express';
import { getResolvedConfig } from '../services/model-configs.service.js';
import { reviewPhoto } from '../services/photo-review.service.js';
import { optimizePrompt } from '../services/prompt-optimize.service.js';
import { optimizePhoto, regeneratePhoto, PhotoOptimizeError } from '../services/photo-optimize.service.js';
import { sendOk, ApiError } from '../utils/response.js';

/**
 * AI 调用代理层：POST /api/ai/:task
 * 具体业务路由（如 photo-review）须注册在通用 :task 之前
 */

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

/**
 * 照片 AI 优化：POST /api/ai/photo-optimize，body: { image: dataURL, scene, note? }
 * 全局 errorHandler 对 ApiError 固定回 data:null，会丢 PhotoOptimizeError 携带的 analysis，
 * 故在此显式处理：错误响应沿用其状态码/code/message，data 放 analysis 供前端展示
 */
aiRouter.post('/api/ai/photo-optimize', async (req, res, next) => {
  try {
    const { analysis, result_image } = await optimizePhoto(req.body);
    sendOk(res, { analysis, result_image });
  } catch (err) {
    if (err instanceof PhotoOptimizeError) {
      res.status(err.status).json({
        code: err.code,
        message: err.message,
        data: { analysis: err.details?.analysis ?? null },
      });
      return;
    }
    // 输入校验/配置缺失等 ApiError 及未知错误走全局 errorHandler
    next(err);
  }
});

/**
 * 仅重发生图（手动重试）：POST /api/ai/photo-optimize/retry
 * body: { image: dataURL, scene, note?, analysis }
 * 生成阶段失败时前端持有 analysis，此端点跳过阶段一直接重绘（后端重新校验 analysis，不信任前端）；
 * 错误处理与 photo-optimize 同款：PhotoOptimizeError 显式回包 data.analysis，其余交全局 errorHandler
 * 该路径为两段（photo-optimize/retry），不会被下方通用 /:task 匹配，仍注册在其前面稳妥
 */
aiRouter.post('/api/ai/photo-optimize/retry', async (req, res, next) => {
  try {
    const { analysis, result_image } = await regeneratePhoto(req.body);
    sendOk(res, { analysis, result_image });
  } catch (err) {
    if (err instanceof PhotoOptimizeError) {
      res.status(err.status).json({
        code: err.code,
        message: err.message,
        data: { analysis: err.details?.analysis ?? null },
      });
      return;
    }
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

/** 通用代理入口（预留）：校验统一模型配置就绪，未实现真实调用的 task 返回 501 */
aiRouter.post('/api/ai/:task', (req, res) => {
  const { task } = req.params;
  const config = getResolvedConfig();
  if (!config.base_url || !config.api_key || !config.default_model) {
    throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '模型服务尚未配置，请先在管理平台完成配置');
  }
  // 配置就绪：本期不实现真实调用，返回 501
  throw new ApiError(501, 'NOT_IMPLEMENTED', `AI 调用代理（${task}）暂未实现，模型配置已就绪`);
});
