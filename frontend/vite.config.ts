import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需引入：模板里写 <el-xxx> 时自动注入组件与对应样式，
    // 不再需要 main.ts 里 app.use(ElementPlus) + 全量 index.css
    Components({
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
      // 生成的类型声明入库，供 vue-tsc 识别模板中自动导入的组件
      dts: 'src/components.d.ts',
    }),
  ],
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
      // 重绘图片等以相对路径引用的接口资源（<img src="/api/redraw/files/...">）
      // axios 请求在开发环境走绝对地址，这里只服务 <img>/<a> 的同源引用
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
});
