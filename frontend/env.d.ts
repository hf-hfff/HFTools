/// <reference types="vite/client" />

// Vue 单文件组件的模块声明（vue-tsc 需要）
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
