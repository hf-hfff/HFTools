import { createApp } from 'vue';
import { createPinia } from 'pinia';
// 样式顺序即层叠顺序：EP 组件样式（由按需插件随组件注入）→ 设计令牌 → EP 覆盖层。
// element-overrides.css 必须最后引入，避免 :root 上的主题变量被 base.css 顶掉。
import './style.css';
import './styles/element-overrides.css';
// 命令式 API 与指令不经过模板解析，按需插件不会替它们注入样式，必须显式引入
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/message-box/style/css';
import 'element-plus/es/components/loading/style/css';
import App from './App.vue';
import router from './router';

const app = createApp(App);

// Pinia 需先于路由守卫使用前安装
app.use(createPinia());
app.use(router);

app.mount('#app');
