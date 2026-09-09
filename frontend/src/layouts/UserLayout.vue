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
          <span class="brand-icon">🧰</span>
          <span class="brand-name">HFTools</span>
          <span class="brand-sub">个人 AI 工具箱</span>
        </div>
        <div class="header-actions">
          <el-button text @click="router.push('/admin')">管理平台</el-button>
        </div>
      </div>
    </el-header>
    <el-main class="user-main">
      <router-view />
    </el-main>
    <el-footer class="user-footer">HFTools · 本地部署 · 仅供个人使用</el-footer>
  </el-container>
</template>

<style scoped>
.user-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.user-header {
  background: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  padding: 0 24px;
  height: 56px;
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
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.brand-icon {
  font-size: 22px;
}

.brand-name {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.brand-sub {
  font-size: 12px;
  color: #909399;
  margin-left: 4px;
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
  color: #909399;
  font-size: 12px;
  background: transparent;
}
</style>
