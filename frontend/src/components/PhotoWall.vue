<script setup lang="ts">
// 背景照片墙：相纸边框 + 种子抖动布局 + 聚光灯轮播，fixed 全屏置于内容之下，纯装饰不参与交互。
// 布局抖动由 seed 决定，两页用不同种子避免完全同构。
import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{ seed: number }>();

interface BgPhoto {
  src: string;
  left: number; // %
  top: number; // %
  width: number; // vw
  rotate: number; // deg
  z: number;
}

/** 确定性伪随机（mulberry32）：布局抖动每次刷新稳定，避免渲染跳动 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const photos: BgPhoto[] = (() => {
  const srcs = Object.values(
    import.meta.glob<string>('../assets/bg-photos/*.webp', {
      eager: true,
      query: '?url',
      import: 'default',
    }),
  );
  const rand = seededRandom(props.seed);
  // 粗略 3 列抖动网格铺满视口，超出裁剪
  const cols = 3;
  return srcs.map((src, i) => ({
    src,
    left: (i % cols) * 33 + rand() * 18 - 4,
    top: Math.floor(i / cols) * 26 + rand() * 16 - 6,
    width: 22 + rand() * 8,
    rotate: rand() * 16 - 8,
    z: 1 + Math.floor(rand() * 9),
  }));
})();

/** 聚光灯轮播：每 3 秒切换选中照片（尊重 prefers-reduced-motion） */
const spotlightIndex = ref(0);
let spotlightTimer: ReturnType<typeof setInterval> | undefined;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

onMounted(() => {
  if (!prefersReducedMotion && photos.length > 1) {
    spotlightTimer = setInterval(() => {
      spotlightIndex.value = (spotlightIndex.value + 1) % photos.length;
    }, 3000);
  }
});

onUnmounted(() => clearInterval(spotlightTimer));
</script>

<template>
  <div v-if="photos.length" class="photo-wall" aria-hidden="true">
    <div
      v-for="(p, i) in photos"
      :key="p.src"
      class="wall-photo"
      :class="{ active: i === spotlightIndex }"
      :style="{
        left: `${p.left}%`,
        top: `${p.top}%`,
        width: `${p.width}vw`,
        '--rot': `${p.rotate}deg`,
        '--z': p.z,
      }"
    >
      <img :src="p.src" alt="" />
    </div>
    <!-- 强蒙层 + vignette：可读性优先 -->
    <div class="wall-veil"></div>
  </div>
</template>

<style scoped>
/* ===== 背景照片墙：fixed 全屏，置于内容之下，不挡交互 ===== */
.photo-wall {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

/* 单张照片：白色相纸边框（底部略宽，显影相纸感） */
.wall-photo {
  position: absolute;
  transform: rotate(var(--rot));
  z-index: var(--z);
  border-radius: 2px;
  background: #f2f0e9;
  padding: 6px 6px 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.wall-photo img {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 1px;
  filter: brightness(0.62) saturate(0.92);
  transform: scale(0.97);
  transition:
    filter 0.8s var(--ease),
    transform 0.8s var(--ease);
}

/* 聚光灯选中态：提亮放大 + 提到蒙层之上（z 60 > veil 50）+ 相纸发光。
   蒙层只压未选中的照片，选中那张按原图亮度出现，轮播切换才看得出来 */
.wall-photo.active {
  z-index: 60;
  box-shadow:
    0 18px 52px rgba(0, 0, 0, 0.62),
    0 0 34px rgba(255, 255, 255, 0.32);
}

.wall-photo.active img {
  filter: brightness(1.08) saturate(1.12);
  transform: scale(1.08);
}

/* 蒙层：可读性优先，但压暗只集中在文字区（画面 50% / 42%），
   四周留亮让照片可见、轮播切换看得出来；原版中心 0.88 + 全局 0.5 把照片墙压成一片黑 */
.wall-veil {
  position: absolute;
  inset: 0;
  z-index: 50;
  background:
    radial-gradient(
      ellipse 82% 68% at 50% 42%,
      rgba(3, 3, 5, 0.76) 0%,
      rgba(3, 3, 5, 0.52) 52%,
      rgba(3, 3, 5, 0.18) 100%
    ),
    rgba(3, 3, 5, 0.32);
}

/* 减少动态偏好：停用轮播过渡 */
@media (prefers-reduced-motion: reduce) {
  .wall-photo,
  .wall-photo img {
    transition: none;
  }
}
</style>
