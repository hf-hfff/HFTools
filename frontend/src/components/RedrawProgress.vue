<script setup lang="ts">
// 重绘进度：时间预估四阶段（后端单次 POST，无真实进度事件）+ 已用秒数 + 60s 后安抚文案
// 不渲染百分比：给出数字用户就会拿它和真实剩余时间对账，卡在最后一段反而更焦虑
import { computed } from 'vue';

const props = defineProps<{
  /** 已等待秒数 */
  elapsed: number;
}>();

/** 四阶段：起始秒数 + 创作语义文案（顺序固定，只前进不回退） */
const STAGES = [
  { at: 0, title: '正在读懂你的创意', desc: '梳理画面主体与风格' },
  { at: 10, title: '正在铺陈画面', desc: '构图、光线就位中' },
  { at: 45, title: '正在打磨光影与细节', desc: '质感与色彩细化中' },
  { at: 100, title: '即将完成', desc: '复杂画面会多花一点时间' },
] as const;

/** 当前阶段（取最后一个已到达的起点） */
const stageIndex = computed(() => {
  let index = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (props.elapsed >= STAGES[i].at) index = i;
  }
  return index;
});

const current = computed(() => STAGES[stageIndex.value]);

/** 已等待超过 60s 追加安抚文案（此时用户最容易放弃） */
const reassuring = computed(() => props.elapsed >= 60);

/** 阶段小圆点的完成态（已过 / 当前 / 未到） */
function dotState(index: number): 'done' | 'active' | 'todo' {
  if (index < stageIndex.value) return 'done';
  if (index === stageIndex.value) return 'active';
  return 'todo';
}
</script>

<template>
  <div class="progress glass" role="status" aria-live="polite">
    <div class="progress-head">
      <span class="spinner" aria-hidden="true" />
      <div class="head-text">
        <p class="stage-title">{{ current.title }}</p>
        <p class="stage-desc">{{ current.desc }}</p>
      </div>
      <span class="elapsed">已等待 {{ elapsed }}s</span>
    </div>

    <div class="track" aria-hidden="true">
      <span class="track-fill" :style="{ width: `${((stageIndex + 1) / STAGES.length) * 100}%` }" />
    </div>

    <div class="stages">
      <span
        v-for="(stage, index) in STAGES"
        :key="stage.title"
        class="stage"
        :class="dotState(index)"
      >
        {{ stage.title }}
      </span>
    </div>

    <p v-if="reassuring" class="reassure">
      图像生成需要一点耐心，请勿关闭页面——完成后会自动展示结果。
    </p>
  </div>
</template>

<style scoped>
.progress {
  padding: 20px 22px;
}

.progress-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.spinner {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.16);
  border-top-color: var(--ink);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.head-text {
  flex: 1;
  min-width: 0;
}

.stage-title {
  margin: 0;
  font-size: 15px;
  color: var(--ink);
}

.stage-desc {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--strip);
}

.elapsed {
  flex: none;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.08em;
  color: var(--nav);
}

.track {
  position: relative;
  height: 2px;
  margin: 18px 0 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.track-fill {
  display: block;
  height: 100%;
  background: var(--ink);
  transition: width 0.8s var(--ease);
}

.stages {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
}

.stage {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #56565a;
  transition: color 0.3s var(--ease);
}

.stage.done {
  color: var(--nav);
}

.stage.active {
  color: var(--ink);
}

.reassure {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--rule);
  font-size: 12.5px;
  color: var(--muted);
}

/* 尊重减少动效偏好：只保留文字与秒数，不停旋转 */
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }

  .track-fill {
    transition: none;
  }
}
</style>
