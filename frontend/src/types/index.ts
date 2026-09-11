/** 后端统一响应结构 */
export interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
}

/** 工具分类：摄影 / AI 工程 / 求职 */
export type ToolCategory = 'photography' | 'ai-eng' | 'job';

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
  status: string;
  sort_order: number;
}

/** 模型配置类型：大语言模型 / 生图模型 / Dify 工作流 */
export type ModelType = 'llm' | 'image-gen' | 'dify';

/** 模型配置（后端返回时 api_key 已脱敏，未配置为 null） */
export interface ModelConfig {
  type: ModelType;
  base_url: string | null;
  api_key: string | null;
  models: string[];
  updated_at: string | null;
}

/** 分类中文名映射 */
export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  photography: '摄影',
  'ai-eng': 'AI 工程',
  job: '求职',
};
