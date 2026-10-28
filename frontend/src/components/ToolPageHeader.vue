<script setup lang="ts">
// 工具页页头：等宽眉题 + 图标 + 标题（+ 副标题）+ 返回工具箱，五个工具页共用。
// variant 只描述「页头压在哪类背景上」，不承担业务；plain / wall 是同一版式的明暗投影差异，
// glass 用于重绘页的壁画背景（更大标题、副标题、幽灵按钮）。
import { useRouter } from 'vue-router';
import ToolIcon from '@/components/ToolIcon.vue';

const props = withDefaults(
  defineProps<{
    crumb: string;
    icon: string;
    title: string;
    subtitle?: string;
    /** 缺省不渲染返回按钮（占位页头部没有这一项） */
    backTo?: string;
    variant?: 'plain' | 'wall' | 'glass';
  }>(),
  { variant: 'plain' },
);

const router = useRouter();

function goBack() {
  if (props.backTo) router.push(props.backTo);
}
</script>

<template>
  <p class="crumb" :class="`variant-${variant}`"><span v-if="variant === 'glass'" class="crumb-rule" aria-hidden="true"></span>{{ crumb }}</p>
  <div class="tool-header" :class="[`variant-${variant}`, { 'has-back': backTo !== undefined }]">
    <span class="tool-icon"><ToolIcon :name="icon" /></span>
    <div v-if="variant === 'glass'" class="title-wrap">
      <h1 class="tool-title">{{ title }}</h1>
      <p v-if="subtitle" class="tool-sub">{{ subtitle }}</p>
    </div>
    <h1 v-else class="tool-title">{{ title }}</h1>
    <button v-if="backTo !== undefined" class="pill back-btn" @click="goBack">← 返回工具箱</button>
  </div>
</template>

<style scoped>
/* ===== 眉题：等宽面包屑 ===== */
.crumb {
  margin: 0 0 26px;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--strip);
}

/* 正文压在照片上：提亮字色 + 双层阴影兜底 */
.crumb.variant-wall {
  color: rgba(250, 250, 250, 0.74);
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 2px 14px rgba(0, 0, 0, 0.8);
}

/* 壁画背景：眉题前加一条细导线，避免文字直接浮在画面上 */
.crumb.variant-glass {
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(250, 250, 250, 0.74);
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 2px 14px rgba(0, 0, 0, 0.75);
}

.crumb-rule {
  width: 30px;
  height: 1px;
  flex: none;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45));
}

/* ===== 页头主体 ===== */
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

/* 正文压在照片上：标题补一层近距阴影 */
.tool-header.variant-wall .tool-title {
  text-shadow:
    0 1px 3px rgba(0, 0, 0, 0.7),
    0 12px 46px rgba(0, 0, 0, 0.9);
}

/* ===== 返回工具箱：走全局描边样式，这里只压缩尺寸 ===== */
.tool-header .back-btn {
  margin-left: auto;
  height: 38px;
  min-width: 0;
  padding: 0 18px;
  font-size: 13.5px;
  cursor: pointer;
}

/* ===== glass 变体：壁画背景上的玻璃语言 ===== */
.tool-header.variant-glass {
  gap: clamp(16px, 2vw, 22px);
  margin-bottom: clamp(26px, 4vh, 40px);
}

.tool-header.variant-glass .tool-icon {
  /* 右上角一点暖光，呼应图标那颗星芒，让 chip 不像一块死玻璃 */
  background:
    radial-gradient(120% 120% at 78% 16%, rgba(255, 214, 168, 0.18), rgba(255, 214, 168, 0) 62%),
    linear-gradient(160deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.03));
  border-color: rgba(255, 255, 255, 0.12);
  color: var(--ink);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    0 12px 30px -14px rgba(0, 0, 0, 0.9);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}

.tool-header.variant-glass .title-wrap {
  min-width: 0;
}

.tool-header.variant-glass .tool-title {
  font-size: clamp(30px, 4.6vw, 46px);
  line-height: 1.15;
  letter-spacing: -0.005em;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.5),
    0 10px 46px rgba(0, 0, 0, 0.9);
}

.tool-sub {
  margin: 9px 0 0;
  font-size: 12.5px;
  letter-spacing: 0.02em;
  color: rgba(250, 250, 250, 0.84);
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 2px 14px rgba(0, 0, 0, 0.8);
}

/* 次要动作：不用白胶囊，避免和页面主 CTA 抢视觉重量 */
.tool-header.variant-glass .back-btn {
  height: 34px;
  min-width: 0;
  padding: 0 16px;
  font-size: 12.5px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.18);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  transition:
    background 0.25s var(--ease),
    border-color 0.25s var(--ease);
}

.tool-header.variant-glass .back-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.3);
  opacity: 1;
}

/* ===== 窄屏：单行放不下时就地收小，标题超长走省略号 ===== */
@media (max-width: 560px) {
  .tool-header.has-back:not(.variant-glass) {
    gap: 10px 12px;
    margin-bottom: 28px;
  }

  .tool-header.has-back:not(.variant-glass) .tool-icon {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    font-size: 22px;
  }

  .tool-header.has-back:not(.variant-glass) .tool-title {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-header.has-back:not(.variant-glass) .back-btn {
    height: 32px;
    padding: 0 12px;
    font-size: 12px;
    white-space: nowrap;
  }

  /* glass：图标与返回按钮同样收小，标题由 title-wrap 承担省略 */
  .tool-header.has-back.variant-glass {
    gap: 12px;
  }

  .tool-header.has-back.variant-glass .tool-icon {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    font-size: 22px;
  }

  .tool-header.has-back.variant-glass .title-wrap {
    flex: 1 1 auto;
    min-width: 0;
  }

  .tool-header.has-back.variant-glass .tool-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-header.has-back.variant-glass .back-btn {
    height: 32px;
    padding: 0 12px;
    font-size: 12px;
    white-space: nowrap;
  }
}

/* ===== 入场动画（glass 页头不做眉题动画、立即淡入）===== */
@media (prefers-reduced-motion: no-preference) {
  .crumb {
    animation: rise 0.7s 0.02s var(--ease) both;
  }

  .tool-header {
    animation: rise 0.8s 0.08s var(--ease) both;
  }

  .crumb.variant-glass {
    animation: none;
  }

  .tool-header.variant-glass {
    animation: rise 0.8s var(--ease) both;
  }
}
</style>
