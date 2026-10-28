<script setup lang="ts">
// 结果区空态：线性图标 + 标题 + 描述。最小高度由各页面的包裹层决定，组件只负责内部排版。
import type { Component } from 'vue';

withDefaults(
  defineProps<{
    icon: Component;
    title: string;
    desc?: string;
  }>(),
  { desc: undefined },
);
</script>

<template>
  <div class="empty-state">
    <el-icon class="empty-icon" aria-hidden="true"><component :is="icon" /></el-icon>
    <p class="empty-title">{{ title }}</p>
    <p v-if="desc" class="empty-desc">{{ desc }}</p>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.empty-icon {
  display: block;
  margin: 0 auto 12px;
  width: 30px;
  height: 30px;
  font-size: 30px;
  color: var(--strip);
  opacity: 0.8;
}

.empty-title {
  margin: 0 0 6px;
  font-size: 15.5px;
  font-weight: 500;
  color: var(--ink);
}

.empty-desc {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
</style>
