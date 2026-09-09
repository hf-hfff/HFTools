<script setup lang="ts">
// 管理平台布局：左侧菜单 + 顶栏（管理员信息/退出登录）
import { useRoute, useRouter } from 'vue-router';
import { Tools, Setting, SwitchButton } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

/** 退出登录并回到登录页 */
function handleLogout() {
  authStore.clearToken();
  router.push({ name: 'admin-login' });
}
</script>

<template>
  <el-container class="admin-layout">
    <el-aside width="220px" class="admin-aside">
      <div class="admin-brand">
        <span class="brand-icon">🧰</span>
        <span class="brand-text">HFTools 管理平台</span>
      </div>
      <el-menu
        :default-active="route.path"
        router
        class="admin-menu"
        background-color="#1d2535"
        text-color="#a3adc2"
        active-text-color="#ffffff"
      >
        <el-menu-item index="/admin/tools">
          <el-icon><Tools /></el-icon>
          <span>工具管理</span>
        </el-menu-item>
        <el-menu-item index="/admin/models">
          <el-icon><Setting /></el-icon>
          <span>模型配置</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="admin-header">
        <span class="header-title">{{ route.meta.title ?? '' }}</span>
        <div class="header-right">
          <span class="admin-name">管理员</span>
          <el-button :icon="SwitchButton" text type="danger" @click="handleLogout">
            退出登录
          </el-button>
        </div>
      </el-header>
      <el-main class="admin-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.admin-layout {
  height: 100vh;
}

.admin-aside {
  background-color: #1d2535;
  display: flex;
  flex-direction: column;
}

.admin-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  height: 56px;
  color: #ffffff;
  font-weight: 600;
  font-size: 15px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.admin-menu {
  border-right: none;
  flex: 1;
}

.admin-header {
  background: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.admin-name {
  font-size: 13px;
  color: #606266;
}

.admin-main {
  background: #f5f7fa;
}
</style>
