/**
 * 模型能力判定（请求期参数整形用，不做保存前校验）
 * 上游 /models 不返回能力元数据，只能用模型名前缀近似判断。
 */

/**
 * 推理模型前缀：o1/o3/o4... 与 gpt-5 系列（含 gpt-5.1 这类点号版本）
 * 说明：o1-mini 等个别模型对 reasoning_effort 支持不一致，联调后可收窄此正则。
 */
const REASONING_MODEL_RE = /^(?:o[1-9](?:-|$)|gpt-5(?:\.\d+)?(?:-|$))/i;

/** 当前模型是否支持 reasoning_effort / reasoning.effort 参数 */
export function supportsReasoning(model: string | null | undefined): boolean {
  if (!model) return false;
  return REASONING_MODEL_RE.test(model.trim());
}
