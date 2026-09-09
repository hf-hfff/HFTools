import { defineStore } from 'pinia';
import { getEnabledTools } from '@/api/tools';
import type { Tool } from '@/types';

/**
 * 用户端工具列表：仅包含已启用工具
 * 首页与占位页共享，避免重复请求
 */
export const useToolsStore = defineStore('tools', {
  state: () => ({
    tools: [] as Tool[],
    loaded: false,
  }),
  actions: {
    /** 拉取已启用工具列表；已加载且未强制刷新时跳过 */
    async fetchTools(force = false) {
      if (this.loaded && !force) return;
      this.tools = await getEnabledTools();
      this.loaded = true;
    },
    /** 管理端切换开关后刷新列表 */
    invalidate() {
      this.loaded = false;
    },
  },
});
