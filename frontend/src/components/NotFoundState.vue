<script setup lang="ts">
// 404 态：大号数字 + 标题 + 说明，行动按钮走默认插槽（有的页面不需要按钮）。
withDefaults(
  defineProps<{
    code?: string;
    title: string;
    desc?: string;
  }>(),
  { code: '404', desc: undefined },
);
</script>

<template>
  <div class="notfound">
    <p class="nf-code">{{ code }}</p>
    <p class="nf-title">{{ title }}</p>
    <p v-if="desc" class="nf-desc">{{ desc }}</p>
    <slot />
  </div>
</template>

<style scoped>
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
</style>
