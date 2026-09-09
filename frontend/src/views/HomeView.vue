<script setup lang="ts">
// 用户端首页：按分类分组展示已启用工具卡片
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight } from '@element-plus/icons-vue';
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

/** 分类展示顺序与文案（配色由 .cat-* 类提供） */
const CATEGORY_META: Array<{ key: ToolCategory; label: string; description: string }> = [
  { key: 'photography', label: '摄影', description: '照片点评、AI 优化与摄影知识' },
  { key: 'ai-eng', label: 'AI 工程', description: '提示词、AI 工具与开源热点' },
  { key: 'job', label: '求职', description: 'JD 拆解、简历优化与公司背调' },
];

/** 按分类分组的工具列表（过滤空分组），并附带序号 */
const groupedTools = computed(() =>
  CATEGORY_META.map(({ key, label, description }, index) => ({
    index,
    key,
    label,
    description,
    tools: toolsStore.tools.filter((tool) => tool.category === key),
  })).filter((group) => group.tools.length > 0),
);

/** 已上线（非占位）工具数，用于首页统计 */
const readyCount = computed(() => toolsStore.tools.filter((t) => t.status !== 'placeholder').length);

/** 点击卡片进入工具页 */
function openTool(tool: Tool) {
  router.push(`/tool/${tool.id}`);
}
</script>

<template>
  <div v-loading="loading" class="home">
    <section class="hero">
      <p class="hero-eyebrow">HFTools · Personal AI Toolbox</p>
      <h1 class="hero-title">常用 AI 工具，一箱收纳</h1>
      <p class="hero-sub">
        摄影 · AI 工程 · 求职 —— 本地运行，{{ toolsStore.tools.length }} 个工具已注册，{{ readyCount }} 个已上线
      </p>
    </section>

    <section v-for="group in groupedTools" :key="group.key" class="category">
      <div class="category-header">
        <span class="category-index">{{ String(group.index + 1).padStart(2, '0') }}</span>
        <h2 class="category-title">{{ group.label }}</h2>
        <span class="category-desc">{{ group.description }}</span>
        <span class="category-count">{{ group.tools.length }} 个工具</span>
      </div>
      <div class="card-grid">
        <button
          v-for="tool in group.tools"
          :key="tool.id"
          class="tool-card"
          :class="`cat-${group.key}`"
          @click="openTool(tool)"
        >
          <span class="tool-icon">{{ tool.icon }}</span>
          <span class="tool-info">
            <span class="tool-name">{{ tool.name }}</span>
            <span v-if="tool.status === 'placeholder'" class="tool-status">开发中</span>
          </span>
          <el-icon class="tool-arrow"><ArrowRight /></el-icon>
        </button>
      </div>
    </section>

    <el-empty
      v-if="!loading && groupedTools.length === 0"
      description="暂无可用工具，请到管理平台启用"
    />
  </div>
</template>

<style scoped>
/* ===== 首屏 ===== */
.hero {
  padding: 44px 4px 4px;
}

.hero-eyebrow {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--el-color-primary);
}

.hero-title {
  margin: 12px 0 10px;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.hero-sub {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

/* ===== 分类区块 ===== */
.category {
  margin-top: 40px;
}

.category-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}

.category-index {
  font-family: var(--mono);
  font-size: 12px;
  color: #b4b4ae;
}

.category-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}

.category-desc {
  font-size: 12.5px;
  color: var(--muted);
}

.category-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 10px;
  background: var(--surface);
}

/* ===== 工具卡片 ===== */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
}

.tool-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.tool-card:hover {
  border-color: var(--chip-fg);
  box-shadow: 0 6px 16px rgba(26, 26, 30, 0.07);
  transform: translateY(-2px);
}

.tool-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

/* 分类配色：图标底色 / 悬停描边 */
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
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--chip-bg);
  font-size: 20px;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tool-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 虚线胶囊表达"进行中"语义 */
.tool-status {
  flex: none;
  font-size: 11px;
  color: var(--muted);
  border: 1px dashed #c9c9c4;
  border-radius: 999px;
  padding: 1px 8px;
}

.tool-arrow {
  margin-left: auto;
  flex: none;
  color: var(--chip-fg);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.tool-card:hover .tool-arrow {
  opacity: 1;
  transform: translateX(0);
}
</style>
