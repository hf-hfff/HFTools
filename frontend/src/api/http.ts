import axios, { type AxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import router from '@/router';
import { TOKEN_KEY } from '@/stores/auth';

/** 后端网关地址（本地部署，后端 CORS 已放行 5173 来源） */
const API_BASE_URL = 'http://localhost:3001/api';

/** 统一 axios 实例 */
export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

// 请求拦截：存在管理员 token 时自动携带 Bearer 鉴权头
http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截：统一错误提示；401 时清除凭证并跳转登录页
http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    const status = error.response?.status;
    const backendMessage = error.response?.data?.message;

    if (status === 401 && router.currentRoute.value.path !== '/admin/login') {
      // 管理接口凭证缺失/过期：清除本地 token 并跳转登录页
      localStorage.removeItem(TOKEN_KEY);
      router.push({ name: 'admin-login', query: { redirect: router.currentRoute.value.fullPath } });
      ElMessage.error('登录已过期，请重新登录');
    } else {
      // 其余错误（含登录失败 401）统一展示后端 message
      ElMessage.error(backendMessage || '请求失败，请稍后重试');
    }
    return Promise.reject(error);
  },
);
