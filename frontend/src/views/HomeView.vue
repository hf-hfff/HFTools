<script setup lang="ts">
// 用户端首页：按分类分组展示已启用工具卡片
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useToolsStore } from '@/stores/tools';
import type { Tool, ToolCategory } from '@/types';

const router = useRouter();
const toolsStore = useToolsStore();
const loading = ref(true);

onMounted(async () => {
  try {
    await toolsStore.fetchTools(true);
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
});

/** 分类展示顺序与文案 */
const CATEGORY_META: Array<{ key: ToolCategory; label: string; description: string }> = [
  { key: 'photography', label: '摄影', description: '照片点评、AI 优化与摄影知识' },
  { key: 'ai-eng', label: 'AI 工程', description: '提示词、AI 工具与开源热点' },
  { key: 'job', label: '求职', description: 'JD 拆解、简历优化与公司背调' },
];

/** 按分类分组的工具列表（过滤空分组） */
const groupedTools = computed(() =>
  CATEGORY_META.map(({ key, label, description }) => ({
    key,
    label,
    description,
    tools: toolsStore.tools.filter((tool) => tool.category === key),
  })).filter((group) => group.tools.length > 0),
);

/** 点击卡片进入工具占位页 */
function openTool(tool: Tool) {
  router.push(`/tool/${tool.id}`);
}
</script>

<template>
  <div v-loading="loading" class="home">
    <section class="hero">
      <h1 class="hero-title">你好，这里是 HFTools</h1>
      <p class="hero-sub">一个本地运行的 AI 工具箱，摄影 · AI 工程 · 求职工具逐步开发中</p>
    </section>

    <section v-for="group in groupedTools" :key="group.key" class="category">
      <div class="category-header">
        <h2 class="category-title">{{ group.label }}</h2>
        <span class="category-desc">{{ group.description }}</span>
      </div>
      <div class="card-grid">
        <el-card
          v-for="tool in group.tools"
          :key="tool.id"
          shadow="hover"
          class="tool-card"
          @click="openTool(tool)"
        >
          <div class="tool-card-body">
            <span class="tool-icon">{{ tool.icon }}</span>
            <div class="tool-info">
              <div class="tool-name">{{ tool.name }}</div>
              <el-tag v-if="tool.status === 'placeholder'" size="small" type="info">开发中</el-tag>
            </div>
          </div>
        </el-card>
      </div>
    </section>

    <el-empty
      v-if="!loading && groupedTools.length === 0"
      description="暂无可用工具，请到管理平台启用"
    />
  </div>
</template>

<style scoped>
.hero {
  padding: 24px 8px 8px;
}

.hero-title {
  margin: 0 0 8px;
  font-size: 26px;
}

.hero-sub {
  margin: 0;
  color: #909399;
}

.category {
  margin-top: 28px;
}

.category-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}

.category-title {
  margin: 0;
  font-size: 18px;
}

.category-desc {
  font-size: 12px;
  color: #909399;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.tool-card {
  cursor: pointer;
  transition: transform 0.15s ease;
}

.tool-card:hover {
  transform: translateY(-2px);
}

.tool-card-body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tool-icon {
  font-size: 28px;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-name {
  font-size: 15px;
  font-weight: 600;
}
</style>
