/** 后端统一响应结构 */
export interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
}

/** 工具分类：摄影 / AI 工程 / 求职 */
export type ToolCategory = 'photography' | 'ai-eng' | 'job';

/** 工具实现状态：active = 已上线，placeholder = 开发中（与后端种子取值一致） */
export type ToolStatus = 'active' | 'placeholder';

/** 工具元数据（与后端 tools 表结构一致，enabled 已转为布尔值） */
export interface Tool {
  id: string;
  name: string;
  category: ToolCategory;
  route: string;
  /** Element Plus 图标名（kebab-case），由 ToolIcon 组件渲染 */
  icon: string;
  enabled: boolean;
  /** 实现状态：placeholder = 未实现（开发中） */
  status: ToolStatus;
  sort_order: number;
}

/** 推理强度（与后端 reasoning_effort 对齐） */
export type ReasoningEffort = 'low' | 'medium' | 'high';

/** 模型配置（单对象，后端返回时 api_key 已脱敏） */
export interface ModelConfig {
  provider: 'openai';
  base_url: string | null;
  api_key: string | null;
  default_model: string | null;
  /** null 表示跟随系统默认生图模型 */
  image_model: string | null;
  reasoning_effort: ReasoningEffort;
  updated_at: string | null;
}

/** 上游模型用途分类 */
export type UpstreamModelKind = 'chat' | 'image' | 'other';

/** 上游模型条目（仅当前页面使用，不缓存） */
export interface UpstreamModel {
  id: string;
  kind: UpstreamModelKind;
}

/** 分类中文名映射 */
export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  photography: '摄影',
  'ai-eng': 'AI 工程',
  job: '求职',
};
