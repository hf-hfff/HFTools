<script setup lang="ts">
// 用户端整体布局：固定顶栏（毛玻璃）+ 内容区 + 页脚
import { useRouter } from 'vue-router';

const router = useRouter();

/** 顶栏中部导航锚点 */
const NAV_SECTIONS = [
  { href: '#cat-photography', label: '摄影' },
  { href: '#cat-ai-eng', label: 'AI 工程' },
  { href: '#cat-job', label: '求职' },
];
</script>

<template>
  <div class="user-layout">
    <header class="topbar">
      <div class="brand" @click="router.push('/')">
        <span class="brand-mark">HF</span>
        <span class="brand-name">HFTools</span>
      </div>
      <nav class="topnav">
        <a v-for="item in NAV_SECTIONS" :key="item.href" :href="item.href" class="topnav-link">
          {{ item.label }}
        </a>
      </nav>
      <button class="pill pill-nav" @click="router.push('/admin')">管理平台</button>
    </header>

    <main class="user-main">
      <router-view />
    </main>

    <footer class="user-footer">
      <p class="foot-meta">HFTOOLS · LOCAL-FIRST · PERSONAL AI TOOLBOX</p>
      <p class="foot-sub">本地部署 · 仅供个人使用</p>
    </footer>
  </div>
</template>

<style scoped>
.user-layout {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

/* ===== 顶栏：固定 + 毛玻璃（源 topbar 实况）=====
   三元素用同一套 grid 轨道，避免绝对定位在窄屏互相压字 */
.topbar {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 50;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  height: 64px;
  padding: 0 clamp(20px, 4vw, 44px);
  background: rgba(5, 5, 5, 0.66);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  justify-self: start;
  cursor: pointer;
  user-select: none;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: #ffffff;
  color: #050505;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.brand-name {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ink);
}

/* 中部锚点导航：参与 grid 居中轨道，不再脱离文档流 */
.topnav {
  justify-self: center;
  display: flex;
  gap: clamp(20px, 2.4vw, 34px);
}

.topnav-link {
  font-size: 14.5px;
  color: var(--nav);
  text-decoration: none;
  letter-spacing: 0.01em;
  transition: color 0.25s var(--ease);
}

.topnav-link:hover {
  color: var(--ink);
}

.topbar .pill-nav {
  justify-self: end;
}

/* ===== 内容区 ===== */
.user-main {
  flex: 1;
  width: 100%;
  padding-top: 64px;
}

/* ===== 页脚 ===== */
.user-footer {
  border-top: 1px solid var(--rule);
  padding: 40px 24px 48px;
  text-align: center;
}

.foot-meta {
  margin: 0;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.24em;
  color: var(--strip);
}

.foot-sub {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--ink-3);
}

/* ===== 响应式：窄屏收起中部导航，避免与品牌 / 管理入口挤在一行 ===== */
@media (max-width: 560px) {
  .topbar {
    gap: 10px;
    padding: 0 16px;
  }

  .topnav {
    display: none;
  }

  .brand-name {
    font-size: 15px;
  }

  .user-footer {
    padding: 32px 20px 40px;
  }
}

@media (max-width: 400px) {
  .brand {
    gap: 8px;
  }

  .brand-mark {
    width: 24px;
    height: 24px;
    border-radius: 7px;
  }

  .brand-name {
    font-size: 14.5px;
  }

  .topbar .pill-nav {
    height: 32px;
    padding: 0 13px;
    font-size: 12.5px;
  }

  .foot-meta {
    font-size: 10.5px;
    letter-spacing: 0.18em;
  }
}

/* ===== 入场动画（源规范时序）===== */
@media (prefers-reduced-motion: no-preference) {
  .brand {
    animation: rise 0.8s var(--ease) both;
  }

  .topnav {
    animation: rise 0.8s var(--ease) both;
  }

  .topbar .pill-nav {
    animation: rise 0.8s var(--ease) both;
  }
}
</style>
