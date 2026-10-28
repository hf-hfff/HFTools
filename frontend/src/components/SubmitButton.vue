<script setup lang="ts">
// 工具页主提交按钮：白色实心胶囊 + 加载态 spinner + 文案切换。
// 不声明 click 事件，父级直接 @click，避免组件隐式承担业务。
withDefaults(
  defineProps<{
    loading?: boolean;
    disabled?: boolean;
    label: string;
    loadingLabel?: string;
  }>(),
  { loading: false, disabled: false, loadingLabel: undefined },
);
</script>

<template>
  <button class="submit-btn" :disabled="disabled || loading">
    <span v-if="!loading">{{ label }}</span>
    <span v-else class="submitting">
      <span class="spinner"></span>
      {{ loadingLabel }}
    </span>
  </button>
</template>

<style scoped>
.submit-btn {
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 999px;
  background: #ffffff;
  color: #050505;
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 12px 20px;
  cursor: pointer;
  transition:
    opacity 0.25s var(--ease),
    transform 0.25s var(--ease);
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.submit-btn:disabled {
  background: rgba(255, 255, 255, 0.1);
  color: var(--muted);
  border-color: var(--rule);
  cursor: not-allowed;
}

.submitting {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(5, 5, 5, 0.25);
  border-top-color: #050505;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
