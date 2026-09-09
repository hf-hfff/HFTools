<script setup lang="ts">
// 用户端整体布局：顶部导航 + 内容区 + 页脚
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <el-container class="user-layout">
    <el-header class="user-header">
      <div class="header-inner">
        <div class="brand" @click="router.push('/')">
          <span class="brand-mark">HF</span>
          <span class="brand-name">HFTools</span>
          <span class="brand-divider"></span>
          <span class="brand-sub">个人 AI 工具箱</span>
        </div>
        <div class="header-actions">
          <button class="admin-link" @click="router.push('/admin')">管理平台</button>
        </div>
      </div>
    </el-header>
    <el-main class="user-main">
      <router-view />
    </el-main>
    <el-footer class="user-footer">
      HFTools · 本地部署 · 仅供个人使用
    </el-footer>
  </el-container>
</template>

<style scoped>
.user-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.user-header {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 60px;
  /* 半透明纸色 + 毛玻璃，与点阵底纹理融合 */
  background: rgba(247, 247, 245, 0.86);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
}

.header-inner {
  max-width: 1080px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--ink);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.brand-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.brand-divider {
  width: 1px;
  height: 12px;
  background: #d5d5cf;
}

.brand-sub {
  font-size: 12.5px;
  color: var(--muted);
}

.admin-link {
  border: none;
  background: transparent;
  font: inherit;
  font-size: 13.5px;
  color: var(--muted);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 8px;
  transition: color 0.15s ease, background 0.15s ease;
}

.admin-link:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.user-main {
  flex: 1;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
}

.user-footer {
  text-align: center;
  color: #b4b4ae;
  font-size: 12px;
  letter-spacing: 1px;
  background: transparent;
}
</style>
