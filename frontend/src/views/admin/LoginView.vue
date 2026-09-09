<script setup lang="ts">
// 管理平台登录页：用户名 + 密码，成功后保存 JWT 并回跳
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Lock, User } from '@element-plus/icons-vue';
import { adminLogin } from '@/api/admin';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({
  username: '',
  password: '',
});

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

/** 提交登录 */
async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    const token = await adminLogin(form.username, form.password);
    authStore.setToken(token);
    ElMessage.success('登录成功');
    // 优先回跳来源页，默认进入工具管理
    const redirect = String(route.query.redirect ?? '/admin/tools');
    router.push(redirect);
  } catch {
    // 登录失败提示已由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <el-card class="login-card">
      <div class="login-header">
        <span class="login-mark">HF</span>
        <h2 class="login-title">HFTools 管理平台</h2>
        <p class="login-sub">请使用管理员账号登录</p>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        size="large"
        @keyup.enter="handleLogin"
      >
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :prefix-icon="User" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :prefix-icon="Lock"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            class="login-button"
            :loading="loading"
            @click="handleLogin"
          >
            登 录
          </el-button>
        </el-form-item>
      </el-form>

      <div class="login-footer">
        <el-link type="info" @click="router.push('/')">返回用户端首页</el-link>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 墨色底 + 顶部一抹品牌色微光 */
  background:
    radial-gradient(600px 300px at 50% 0%, rgba(67, 56, 202, 0.28), transparent 70%),
    #17171c;
}

.login-card {
  width: 380px;
  padding: 8px 4px;
  border-radius: 16px;
  border: none;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
}

.login-header {
  text-align: center;
  margin-bottom: 20px;
}

.login-mark {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #4338ca;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
}

.login-title {
  margin: 12px 0 4px;
  font-size: 20px;
}

.login-sub {
  margin: 0;
  color: #8a8a93;
  font-size: 13px;
}

.login-button {
  width: 100%;
}

.login-footer {
  text-align: center;
  margin-top: 4px;
}
</style>
