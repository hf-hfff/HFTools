<script setup lang="ts">
// 页面背景：把「原图 → 重绘」示例图纵向铺成数条画廊，相邻列反向缓慢漂移。
// 之上叠加：中心暗幕（保证正文可读）+ 顶部压暗（压住顶栏过渡）+ 胶片颗粒 + 跟随指针的暖光。
// 纯装饰层，pointer-events: none，不参与交互与读屏。
import { onMounted, onUnmounted, ref } from 'vue';

/** 纵向列数与每列图数：8 列时 1440px 屏单列约 180px，一屏能看到近 20 张，才成「墙」；
 *  列数偏少会退化成几张放大的照片，失去画廊感。
 *  每列 4 张保证单份内容高于常见视口，循环时不会露白。 */
const COLUMN_COUNT = 8;
const IMAGES_PER_COLUMN = 4;

/** 漂移周期基准（秒）：越小越快。整墙调速只改 SPEED（2.5 = 初版 1 倍速的 2.5 倍，单列 35–65s） */
const BASE_DURATION_S = 88;
const SPEED = 2.5;

/** 每列漂移周期（秒）与方向：周期两两错开，整面墙不同频，才不像一块整体平移的板子 */
const COLUMN_MOTION = Array.from({ length: COLUMN_COUNT }, (_, i) => ({
  duration: Math.round((BASE_DURATION_S + (i % 5) * 17 + (i % 3) * 7) / SPEED),
  down: i % 2 === 1,
}));

/** 素材按文件名排序（01…14），保证每次构建顺序一致 */
const ALL_IMAGES: string[] = (() => {
  const modules = import.meta.glob<string>('../assets/redraw-mural/*.jpg', {
    eager: true,
    query: '?url',
    import: 'default',
  });
  return Object.keys(modules)
    .sort()
    .map((key) => modules[key]);
})();

/** 列内容：隔行取样，各列画面不重复，避免左右撞图 */
const columns = ALL_IMAGES.length
  ? Array.from({ length: COLUMN_COUNT }, (_, col) =>
      Array.from(
        { length: IMAGES_PER_COLUMN },
        (_, i) => ALL_IMAGES[(col + i * COLUMN_COUNT) % ALL_IMAGES.length],
      ),
    )
  : [];

/* ===== 指针暖光：仅桌面端点设备启用，rAF 节流写入 CSS 变量 ===== */
const wallEl = ref<HTMLElement>();
const pointerActive = ref(false);
let rafId = 0;
let pendingX = 0;
let pendingY = 0;

function applyPointer() {
  rafId = 0;
  const el = wallEl.value;
  if (!el) return;
  el.style.setProperty('--spot-x', `${pendingX}px`);
  el.style.setProperty('--spot-y', `${pendingY}px`);
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return;
  pendingX = event.clientX;
  pendingY = event.clientY;
  if (!pointerActive.value) pointerActive.value = true;
  if (rafId === 0) rafId = requestAnimationFrame(applyPointer);
}

/* ===== 滚动视差：墙面比正文慢半拍，产生「隔窗看画廊」的纵深 =====
   位移上限受 scale(1.1) 的余量约束（约 40px），超出会露出黑边 */
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let scrollRaf = 0;

function applyScroll() {
  scrollRaf = 0;
  const el = wallEl.value;
  if (!el) return;
  el.style.setProperty('--wall-shift', `${-Math.min(window.scrollY * 0.04, 40)}px`);
}

function onScroll() {
  if (scrollRaf === 0) scrollRaf = requestAnimationFrame(applyScroll);
}

onMounted(() => {
  if (window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
  }
  if (!prefersReducedMotion) {
    window.addEventListener('scroll', onScroll, { passive: true });
  }
});

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('scroll', onScroll);
  if (rafId) cancelAnimationFrame(rafId);
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
});
</script>

<template>
  <div ref="wallEl" class="mural" :class="{ 'spot-on': pointerActive }" aria-hidden="true">
    <div class="mural-wall">
      <div
        v-for="(column, index) in columns"
        :key="index"
        class="mural-col"
        :class="{ down: COLUMN_MOTION[index].down }"
        :style="{
          '--dur': `${COLUMN_MOTION[index].duration}s`,
          '--delay': `${index * -9}s`,
        }"
      >
        <!-- 两份完全相同的内容：位移 -50% 时首尾严丝合缝，实现无缝循环 -->
        <div v-for="copy in 2" :key="copy" class="mural-run">
          <img
            v-for="(src, i) in column"
            :key="`${copy}-${i}`"
            :src="src"
            alt=""
            decoding="async"
            draggable="false"
          />
        </div>
      </div>
    </div>

    <div class="mural-veil"></div>
    <div class="mural-grain"></div>
    <div class="mural-spot"></div>
  </div>
</template>

<style scoped>
.mural {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: #050505;
  animation: fade 1.4s var(--ease) both;
}

/* 整体放大，避免漂移/圆角处露出边缘 */
.mural-wall {
  position: absolute;
  top: -48px;
  left: -48px;
  right: -48px;
  height: calc(100% + 96px);
  display: flex;
  gap: 8px;
  /* 仅位移，不用 scale：缩放整个超大图层会持续重采样，代价明显 */
  transform: translate3d(0, var(--wall-shift, 0px), 0);
  opacity: 0.9;
}

/* 左右两端淡出：用覆盖层实现，比在超大动画层上挂 mask 便宜得多 */
.mural::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    #050505 0%,
    rgba(5, 5, 5, 0.55) 3%,
    rgba(5, 5, 5, 0) 9%,
    rgba(5, 5, 5, 0) 91%,
    rgba(5, 5, 5, 0.55) 97%,
    #050505 100%
  );
}

.mural-col {
  flex: 1 1 0;
  min-width: 0;
  animation: drift-up var(--dur) linear infinite;
  animation-delay: var(--delay);
}

.mural-col.down {
  animation-name: drift-down;
}

.mural-run {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 与列间 gap 同值：位移半个列高时首尾对齐 */
  padding-bottom: 8px;
}

.mural-col img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 4px;
  background: #0f0f0f;
}

@keyframes drift-up {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(0, -50%, 0);
  }
}

@keyframes drift-down {
  from {
    transform: translate3d(0, -50%, 0);
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}

/* ===== 收口暗幕：顶部压住标题区、底部给页脚留黑，其余交给玻璃面板自己保证可读 ===== */
.mural-veil {
  position: absolute;
  inset: 0;
  background-color: rgba(5, 5, 5, 0.3);
  background-image:
    linear-gradient(
      180deg,
      rgba(5, 5, 5, 0.95) 0%,
      rgba(5, 5, 5, 0.8) 8%,
      rgba(5, 5, 5, 0.52) 18%,
      rgba(5, 5, 5, 0.2) 32%,
      rgba(5, 5, 5, 0.02) 48%,
      rgba(5, 5, 5, 0) 62%
    ),
    linear-gradient(
      0deg,
      rgba(5, 5, 5, 0.94) 0%,
      rgba(5, 5, 5, 0.6) 12%,
      rgba(5, 5, 5, 0.18) 28%,
      rgba(5, 5, 5, 0) 42%
    );
}

/* 胶片颗粒：SVG 噪声，压住数码感 */
.mural-grain {
  position: absolute;
  inset: 0;
  opacity: 0.055;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.86' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px 160px;
}

/* 指针暖光：只在鼠标移动后淡入，触屏与小屏不出现 */
.mural-spot {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.8s var(--ease);
  mix-blend-mode: screen;
  background: radial-gradient(
    380px circle at var(--spot-x, 50%) var(--spot-y, 30%),
    rgba(255, 236, 208, 0.14) 0%,
    rgba(255, 226, 190, 0.05) 42%,
    transparent 72%
  );
}

.mural.spot-on .mural-spot {
  opacity: 1;
}

/* 窄屏按断点减少列数，保证单列宽度不至于细成竖条 */
@media (max-width: 1280px) {
  .mural-col:nth-child(n + 7) {
    display: none;
  }
}

@media (max-width: 1024px) {
  .mural-col:nth-child(n + 5) {
    display: none;
  }
}

@media (max-width: 820px) {
  .mural-col:nth-child(n + 3) {
    display: none;
  }
}

/* 关闭动效：停止漂移，保持静态画廊 */
@media (prefers-reduced-motion: reduce) {
  .mural-col {
    animation: none;
  }

  .mural-spot {
    display: none;
  }
}
</style>
