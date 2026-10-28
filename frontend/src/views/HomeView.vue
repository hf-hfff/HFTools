<script setup lang="ts">
// 用户端首页：电影感舞台首屏 + 按分类分组展示已启用工具卡片
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight } from '@element-plus/icons-vue';
import ToolIcon from '@/components/ToolIcon.vue';
import heroPlateUrl from '@/assets/portal_scene.webp';
import { useToolsStore } from '@/stores/tools';
import type { Tool, ToolCategory } from '@/types';

const router = useRouter();
const toolsStore = useToolsStore();
const loading = ref(true);

onMounted(async () => {
  try {
    // 不强制刷新：store 已有数据时直接复用，避免每次进首页重复 GET
    await toolsStore.fetchTools();
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
});

/** 分类展示顺序与文案 */
const CATEGORY_META: Array<{ key: ToolCategory; label: string; en: string; description: string }> = [
  { key: 'photography', label: '摄影', en: 'Photography', description: '照片点评、AI 优化与摄影知识' },
  { key: 'ai-eng', label: 'AI 工程', en: 'AI Engineering', description: '提示词、AI 工具与开源热点' },
  { key: 'job', label: '求职', en: 'Career', description: 'JD 拆解、简历优化与公司背调' },
];

/** 按分类分组的工具列表（过滤空分组） */
const groupedTools = computed(() =>
  CATEGORY_META.map(({ key, label, en, description }, index) => ({
    index,
    key,
    label,
    en,
    description,
    tools: toolsStore.tools.filter((tool) => tool.category === key),
  })).filter((group) => group.tools.length > 0),
);

/** 已上线（非占位）工具数 */
const readyCount = computed(() => toolsStore.tools.filter((t) => t.status !== 'placeholder').length);

/** 点击卡片进入工具页：已上线工具跳注册路由，开发中走占位页 */
function openTool(tool: Tool) {
  router.push(tool.status === 'placeholder' ? `/tool/${tool.id}` : tool.route);
}
</script>

<template>
  <div class="home">
    <!-- ===== 舞台首屏：舞台照片 + 中心压暗 + 电影感底部渐隐 ===== -->
    <section class="hero">
      <!-- 背景图层（源 plate 构图） -->
      <div class="hero-plate" role="presentation" :style="{ backgroundImage: `url(${heroPlateUrl})` }"></div>

      <div class="hero-inner">
        <p class="hero-eyebrow">HFTools · Personal AI Toolbox</p>
        <h1 class="headline">
          <span>AI 能力集成平台</span>
          <span>工具链一站式调度</span>
        </h1>
        <p class="sub">
          <span>摄影 · AI 工程 · 求职</span>
          <span>本地运行 · {{ toolsStore.tools.length }} 个工具已注册 · {{ readyCount }} 个已上线</span>
        </p>
      </div>

      <!-- 底部分类条：真实锚点，点击直达对应分区 -->
      <nav class="strip" aria-label="工具分类">
        <a v-for="group in groupedTools" :key="group.key" class="strip-item" :href="`#cat-${group.key}`">
          {{ group.label }}<i class="dot" aria-hidden="true"></i>
        </a>
      </nav>
    </section>

    <!-- ===== 工具分区（loading 只罩内容区，不盖首屏）===== -->
    <div id="tools" v-loading="loading" class="sections">
      <section
        v-for="group in groupedTools"
        :id="`cat-${group.key}`"
        :key="group.key"
        class="category"
      >
        <div class="eyebrow">
          <span class="eyebrow-index">{{ String(group.index + 1).padStart(2, '0') }}</span>
          <span class="eyebrow-en">{{ group.en }}</span>
        </div>
        <div class="category-header">
          <h2 class="category-title">{{ group.label }}</h2>
          <p class="category-desc">{{ group.description }}</p>
        </div>
        <div class="card-grid">
          <button
            v-for="(tool, i) in group.tools"
            :key="tool.id"
            class="tool-card"
            :style="{ '--i': i }"
            @click="openTool(tool)"
          >
            <span class="tool-icon"><ToolIcon :name="tool.icon" /></span>
            <span class="tool-info">
              <span class="tool-name">{{ tool.name }}</span>
              <span v-if="tool.status === 'placeholder'" class="tool-status">开发中</span>
              <span v-else class="tool-status tool-status--ready">可用</span>
            </span>
            <el-icon class="tool-arrow"><ArrowRight /></el-icon>
          </button>
        </div>
      </section>
    </div>

    <el-empty
      v-if="!loading && groupedTools.length === 0"
      description="暂无可用工具，请到管理平台启用"
    />
  </div>
</template>

<style scoped>
/* ===== 舞台首屏 ===== */
.hero {
  position: relative;
  min-height: max(560px, calc(100vh - 64px));
  min-height: max(560px, calc(100dvh - 64px));
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #050505;
}

/* 背景图层（源 plate 实况：舞台照片全幅铺底，图片由模板绑定，便于拿到内容哈希） */
.hero-plate {
  position: absolute;
  inset: 0;
  background-position: center 62%;
  background-size: cover;
  background-repeat: no-repeat;
}

/* 中心压暗：保证居中文字可读，边缘保留画面（替代源左右渐隐的居中版式适配） */
.hero-plate::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    75% 65% at 50% 42%,
    rgba(5, 5, 5, 0.68) 0%,
    rgba(5, 5, 5, 0.46) 48%,
    rgba(5, 5, 5, 0.16) 100%
  );
}

/* 电影感底部渐隐（源规范多段渐隐曲线） */
.hero::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    rgba(5, 5, 5, 0) 68%,
    rgba(5, 5, 5, 0.45) 80%,
    rgba(5, 5, 5, 0.75) 86%,
    rgba(5, 5, 5, 0.905) 91%,
    rgba(5, 5, 5, 0.96) 95%,
    #050505 100%
  );
}

.hero-inner {
  position: relative;
  z-index: 2;
  text-align: center;
  padding: 0 24px;
}

.hero-eyebrow {
  margin: 0 0 22px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.24em;
  color: var(--strip);
  text-transform: uppercase;
}

.headline {
  margin: 0;
  /* 下限 40→30：360px 视口下「工具链一站式调度」8 字不再折行 */
  font-size: clamp(30px, 7vw, 68px);
  line-height: 1.12;
  font-weight: 300;
  letter-spacing: 0.01em;
  color: var(--ink);
}

.headline span {
  display: block;
  /* 中文词组整体换行，避免出现「调 / 度」这类断字 */
  word-break: keep-all;
  overflow-wrap: normal;
}

.sub {
  margin: 26px 0 0;
  font-size: clamp(15px, 1.8vw, 19px);
  line-height: 1.5;
  color: var(--muted);
}

.sub span {
  display: block;
}

/* 底部分类条 */
.strip {
  position: absolute;
  z-index: 2;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  display: flex;
  gap: clamp(28px, 5vw, 56px);
  color: var(--strip);
}

.strip-item {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: inherit;
  text-decoration: none;
  transition: color 0.25s var(--ease);
}

.strip-item:hover {
  color: var(--ink);
}

.dot {
  display: inline-block;
  width: 0.1em;
  height: 0.1em;
  border-radius: 50%;
  background: currentColor;
  vertical-align: 0.62em;
  margin-left: 0.3em;
}

/* ===== 工具分区 ===== */
.sections {
  max-width: 1060px;
  margin: 0 auto;
  padding: 0 clamp(20px, 4vw, 40px);
}

.category {
  padding: clamp(72px, 10vh, 110px) 0 0;
  scroll-margin-top: 76px;
}

/* 眉题：渐变短划线 + 等宽编号（源 eyebrow 实况） */
.eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.eyebrow::before {
  content: '';
  width: 30px;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, #6f6f6f, #c9c9c9);
}

.eyebrow-index,
.eyebrow-en {
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--strip);
}

.eyebrow-index {
  color: var(--ink);
}

.category-header {
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.category-title {
  margin: 0;
  font-size: clamp(26px, 3.4vw, 34px);
  font-weight: 400;
  color: var(--ink);
  line-height: 1.16;
  letter-spacing: 0.01em;
}

.category-desc {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
}

/* ===== 工具卡片（源 card 实况：bg2 + rule 描边 + 14px 圆角）===== */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 14px;
}

.tool-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  background: var(--bg2);
  border: 1px solid var(--rule);
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition:
    border-color 0.25s var(--ease),
    background-color 0.25s var(--ease),
    transform 0.25s var(--ease);
}

.tool-card:hover {
  border-color: rgba(255, 255, 255, 0.24);
  background: var(--bg3);
  transform: translateY(-2px);
}

.tool-card:focus-visible {
  outline: 2px solid #fafafa;
  outline-offset: 2px;
}

.tool-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 20px;
  /* button 不继承 body 浅色，图标需显式指定，否则为浏览器默认深色 */
  color: var(--ink);
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

/* 虚线胶囊表达 WIP 语义（单色化） */
.tool-status {
  flex: none;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--strip);
  border: 1px dashed rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  padding: 2px 9px;
}

/* 已上线：实线绿胶囊，与 WIP 虚线灰形成状态对比 */
.tool-status--ready {
  color: var(--success);
  border: 1px solid rgba(159, 220, 174, 0.38);
  background: rgba(159, 220, 174, 0.08);
}

.tool-arrow {
  margin-left: auto;
  flex: none;
  color: var(--strip);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 0.25s var(--ease),
    transform 0.25s var(--ease);
}

.tool-card:hover .tool-arrow {
  opacity: 1;
  transform: translateX(0);
  color: var(--ink);
}

/* 最后一个分区补底部间距 */
.category:last-of-type {
  padding-bottom: clamp(72px, 10vh, 110px);
}

/* ===== 响应式（此前首页零断点，窄屏全靠运气）===== */
@media (max-width: 640px) {
  .hero {
    flex-direction: column;
    min-height: max(480px, calc(100dvh - 64px));
    padding: 88px 0 48px;
  }

  .hero-inner {
    padding: 0 20px;
  }

  .hero-eyebrow {
    margin-bottom: 16px;
    font-size: 10.5px;
    letter-spacing: 0.2em;
  }

  .headline {
    font-size: clamp(30px, 8.4vw, 44px);
  }

  .sub {
    margin-top: 20px;
    font-size: 14px;
  }

  /* 分类条从绝对定位改为常规流，随内容排布不再溢出 */
  .strip {
    position: static;
    transform: none;
    margin-top: 40px;
    gap: 22px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .sections {
    padding: 0 20px;
  }

  .category {
    padding-top: 64px;
    scroll-margin-top: 72px;
  }

  .category-header {
    gap: 8px;
    margin-bottom: 16px;
  }
}

@media (max-width: 400px) {
  .hero {
    padding: 76px 0 40px;
  }

  .headline {
    font-size: 30px;
  }

  .strip-item {
    font-size: 13.5px;
  }

  .card-grid {
    grid-template-columns: 1fr;
  }

  .tool-card {
    padding: 14px;
  }
}

/* ===== 入场动画（源规范时序：.02/.06/.14/.22/.34 交错）===== */
@media (prefers-reduced-motion: no-preference) {
  .hero-plate {
    animation: fade 1.6s ease both;
  }

  .hero-inner {
    animation: fade 1.2s ease both;
  }

  .hero-eyebrow {
    animation: rise 0.9s 0.02s var(--ease) both;
  }

  .headline {
    animation: rise 0.9s 0.06s var(--ease) both;
  }

  .sub {
    animation: rise 0.9s 0.14s var(--ease) both;
  }

  .strip-item {
    animation: fade 1.1s 0.34s ease both;
  }

  .tool-card {
    animation: rise 0.7s var(--ease) both;
    animation-delay: calc(0.28s + var(--i) * 0.05s);
  }
}
</style>
