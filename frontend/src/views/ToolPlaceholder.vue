<script setup lang="ts">
// 工具占位页：status=placeholder 时展示"开发中"，未找到/未启用时展示未找到
import { useRoute, useRouter } from 'vue-router';
import NotFoundState from '@/components/NotFoundState.vue';
import ToolPageHeader from '@/components/ToolPageHeader.vue';
import { useToolMeta } from '@/composables/useToolMeta';

const route = useRoute();
const router = useRouter();

const { tool, loading, notFound } = useToolMeta(() => String(route.params.id ?? ''));
</script>

<template>
  <div v-loading="loading" class="tool-page">
    <template v-if="tool">
      <ToolPageHeader :crumb="`TOOLS / ${tool.id.toUpperCase()}`" :icon="tool.icon" :title="tool.name" />

      <!-- 未实现的工具统一展示开发中占位 -->
      <div v-if="tool.status === 'placeholder'" class="wip-panel">
        <p class="wip-badge">WIP</p>
        <p class="wip-title">正在开发中</p>
        <p class="wip-desc">该工具已在规划内，敬请期待。可以先回工具箱看看其他工具。</p>
        <button class="pill" @click="router.push('/')">返回工具箱</button>
      </div>
      <div v-else class="tool-content">
        <!-- 工具实现后在此渲染业务组件 -->
      </div>
    </template>

    <NotFoundState v-else-if="notFound" title="未找到该工具" desc="可能已被下线或禁用">
      <button class="pill" @click="router.push('/')">返回首页</button>
    </NotFoundState>
  </div>
</template>

<style scoped>
.tool-page {
  min-height: calc(100vh - 64px);
  min-height: calc(100dvh - 64px);
  max-width: 1060px;
  margin: 0 auto;
  padding: clamp(16px, 2.667vh, 32px) clamp(20px, 4vw, 40px);
}

/* 开发中占位面板（源 card 风格 + 虚线 WIP 语义） */
.wip-panel {
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  background: var(--bg2);
  padding: clamp(44px, 8vh, 72px) 24px;
  text-align: center;
}

.wip-badge {
  display: inline-block;
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.24em;
  color: var(--strip);
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 3px 12px;
}

.wip-title {
  margin: 18px 0 8px;
  font-size: 20px;
  font-weight: 500;
  color: var(--ink);
}

.wip-desc {
  margin: 0 0 28px;
  color: var(--muted);
  font-size: 14px;
}

.tool-content {
  padding: 16px 0;
}

/* ===== 入场动画 ===== */
@media (prefers-reduced-motion: no-preference) {
  .wip-panel {
    animation: rise 0.8s 0.16s var(--ease) both;
  }
}
</style>
