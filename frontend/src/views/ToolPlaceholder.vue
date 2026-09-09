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
      <!-- 眉题：等宽面包屑 -->
      <p class="crumb">TOOLS / {{ tool.id.toUpperCase() }}</p>

      <div class="tool-header">
        <span class="tool-icon">{{ tool.icon }}</span>
        <h2 class="tool-title">{{ tool.name }}</h2>
      </div>

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

    <div v-else-if="!loading" class="notfound">
      <p class="nf-code">404</p>
      <p class="nf-title">未找到该工具</p>
      <p class="nf-desc">可能已被下线或禁用</p>
      <button class="pill" @click="router.push('/')">返回首页</button>
    </div>
  </div>
</template>

<style scoped>
.tool-page {
  min-height: calc(100vh - 64px);
  max-width: 1060px;
  margin: 0 auto;
  padding: clamp(48px, 8vh, 96px) clamp(20px, 4vw, 40px);
}

/* 眉题面包屑（源 eyebrow 风格） */
.crumb {
  margin: 0 0 26px;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--strip);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 36px;
}

.tool-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 26px;
}

.tool-title {
  margin: 0;
  font-size: clamp(28px, 4vw, 38px);
  font-weight: 300;
  letter-spacing: 0.01em;
  color: var(--ink);
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

/* 未找到态 */
.notfound {
  text-align: center;
  padding: clamp(44px, 10vh, 88px) 0;
}

.nf-code {
  margin: 0;
  font-family: var(--mono);
  font-size: clamp(48px, 8vw, 72px);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.14);
  line-height: 1;
}

.nf-title {
  margin: 18px 0 6px;
  font-size: 19px;
  font-weight: 500;
  color: var(--ink);
}

.nf-desc {
  margin: 0 0 28px;
  font-size: 14px;
  color: var(--muted);
}

/* ===== 入场动画 ===== */
@media (prefers-reduced-motion: no-preference) {
  .crumb {
    animation: rise 0.7s 0.02s var(--ease) both;
  }

  .tool-header {
    animation: rise 0.8s 0.08s var(--ease) both;
  }

  .wip-panel,
  .notfound {
    animation: rise 0.8s 0.16s var(--ease) both;
  }
}
</style>
