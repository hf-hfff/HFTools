<script setup lang="ts">
// 工具占位页：status=placeholder 时展示"开发中"，未找到/未启用时展示未找到
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useToolsStore } from '@/stores/tools';

const route = useRoute();
const router = useRouter();
const toolsStore = useToolsStore();
const loading = ref(true);

onMounted(async () => {
  try {
    // 直接通过 URL 访问时工具列表可能尚未加载
    await toolsStore.fetchTools(true);
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
});

const toolId = computed(() => String(route.params.id ?? ''));
const tool = computed(() => toolsStore.tools.find((t) => t.id === toolId.value));
</script>

<template>
  <div v-loading="loading" class="tool-page">
    <template v-if="tool">
      <div class="tool-header">
        <span class="tool-icon">{{ tool.icon }}</span>
        <h2 class="tool-title">{{ tool.name }}</h2>
      </div>

      <!-- 未实现的工具统一展示开发中占位 -->
      <el-empty
        v-if="tool.status === 'placeholder'"
        description="该工具正在开发中，敬请期待"
        :image-size="120"
      />
      <div v-else class="tool-content">
        <!-- 工具实现后在此渲染业务组件 -->
      </div>
    </template>

    <el-empty
      v-else-if="!loading"
      description="未找到该工具，可能已被下线或禁用"
      :image-size="120"
    >
      <el-button type="primary" @click="router.push('/')">返回首页</el-button>
    </el-empty>
  </div>
</template>

<style scoped>
.tool-page {
  min-height: 360px;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 8px 8px;
}

.tool-icon {
  font-size: 30px;
}

.tool-title {
  margin: 0;
  font-size: 22px;
}

.tool-content {
  padding: 16px;
}
</style>
