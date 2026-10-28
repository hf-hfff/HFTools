<script setup lang="ts">
import { ElConfigProvider } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
</script>

<template>
  <!-- 全量注册移除后，语言包改由 ConfigProvider 提供（分页器、空态、表单校验等文案） -->
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>
