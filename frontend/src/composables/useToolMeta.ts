import { computed, onMounted, ref } from 'vue';
import { useToolsStore } from '@/stores/tools';

/**
 * 工具页公共元信息：拉取已启用工具列表并解析当前工具。
 * getId 返回当前工具 id（常量或 route 参数）；列表由 store 缓存，多页访问只请求一次。
 */
export function useToolMeta(getId: () => string) {
  const toolsStore = useToolsStore();
  const loading = ref(true);

  const tool = computed(() => toolsStore.tools.find((t) => t.id === getId()));
  // 列表拉取完成仍未命中 → 工具不存在或已被禁用
  const notFound = computed(() => !loading.value && tool.value === undefined);

  onMounted(async () => {
    try {
      // 直接通过 URL 访问时工具列表可能尚未加载；store 已有数据则直接复用
      await toolsStore.fetchTools();
    } catch {
      // 错误提示已由 axios 拦截器统一处理
    } finally {
      loading.value = false;
    }
  });

  return { tool, loading, notFound };
}
