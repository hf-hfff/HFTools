<script setup lang="ts">
// 全站 404：路由未命中任何页面时展示，仍嵌在用户端布局（顶栏 + 页脚）之下
import { useRouter } from 'vue-router';
import NotFoundState from '@/components/NotFoundState.vue';

const router = useRouter();
</script>

<template>
  <div class="nf-page">
    <NotFoundState title="页面不存在" desc="链接可能已失效，或地址输错了">
      <button class="pill" @click="router.push('/')">返回首页</button>
    </NotFoundState>
  </div>
</template>

<style scoped>
.nf-page {
  min-height: calc(100vh - 64px);
  min-height: calc(100dvh - 64px);
  max-width: 1060px;
  margin: 0 auto;
  padding: clamp(16px, 2.667vh, 32px) clamp(20px, 4vw, 40px);
}
</style>
