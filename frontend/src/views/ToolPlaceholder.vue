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
      <div class="tool-header" :class="`cat-${tool.category}`">
        <span class="tool-icon">{{ tool.icon }}</span>
        <div class="tool-heading">
          <h2 class="tool-title">{{ tool.name }}</h2>
          <span class="tool-breadcrumb" @click="router.push('/')">返回工具箱</span>
        </div>
      </div>

      <!-- 未实现的工具统一展示开发中占位 -->
      <div v-if="tool.status === 'placeholder'" class="wip-panel">
        <p class="wip-badge">WIP</p>
        <p class="wip-title">正在开发中</p>
        <p class="wip-desc">该工具已在规划内，敬请期待。可以先回首页看看其他工具。</p>
        <el-button @click="router.push('/')">返回首页</el-button>
      </div>
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
  min-height: 400px;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 28px 4px 20px;
}

/* 分类配色与首页保持一致 */
.cat-photography {
  --chip-bg: #faeedd;
  --chip-fg: #9a5b13;
}

.cat-ai-eng {
  --chip-bg: #e9eafb;
  --chip-fg: #3f3bb8;
}

.cat-job {
  --chip-bg: #ddf2e8;
  --chip-fg: #157a55;
}

.tool-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: var(--chip-bg);
  font-size: 26px;
}

.tool-heading {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.tool-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}

.tool-breadcrumb {
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
  transition: color 0.15s ease;
}

.tool-breadcrumb:hover {
  color: var(--el-color-primary);
}

/* 开发中占位面板：虚线边框呼应首页"开发中"胶囊 */
.wip-panel {
  margin-top: 12px;
  border: 1px dashed #c9c9c4;
  border-radius: 14px;
  background: var(--surface);
  padding: 48px 24px;
  text-align: center;
}

.wip-badge {
  display: inline-block;
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 10px;
}

.wip-title {
  margin: 14px 0 6px;
  font-size: 17px;
  font-weight: 700;
}

.wip-desc {
  margin: 0 0 20px;
  color: var(--muted);
  font-size: 13.5px;
}

.tool-content {
  padding: 16px;
}
</style>
