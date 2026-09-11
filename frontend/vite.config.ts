import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 固定 5173 端口（后端 CORS 已放行该来源）
    port: 5173,
    proxy: {
      // 后端静态资源（熊猫动图等）：开发环境代理到本地网关，与生产 nginx 同构
      '/static': {
        target: 'http://localhost:3001',
      },
    },
  },
});
