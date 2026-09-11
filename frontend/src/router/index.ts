import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // 用户端：首页 + 工具占位页
    {
      path: '/',
      component: () => import('@/layouts/UserLayout.vue'),
      children: [
        { path: '', name: 'home', component: () => import('@/views/HomeView.vue') },
        {
          // 已上线工具的正式路由（与 tools 表 route 字段一致），须在通用 tool/:id 之前匹配
          path: 'tools/photo-review',
          name: 'photo-review',
          component: () => import('@/views/PhotoReviewView.vue'),
        },
        {
          path: 'tool/:id',
          name: 'tool',
          component: () => import('@/views/ToolPlaceholder.vue'),
        },
      ],
    },
    // 管理平台登录页（独立布局，不需要鉴权）
    {
      path: '/admin/login',
      name: 'admin-login',
      component: () => import('@/views/admin/LoginView.vue'),
    },
    // 管理平台（需登录）
    {
      path: '/admin',
      component: () => import('@/layouts/AdminLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'admin-tools' } },
        {
          path: 'tools',
          name: 'admin-tools',
          component: () => import('@/views/admin/ToolsView.vue'),
        },
        {
          path: 'models',
          name: 'admin-models',
          component: () => import('@/views/admin/ModelsView.vue'),
        },
      ],
    },
    // 其余路径统一回首页
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

// 全局守卫：管理端页面未登录时跳转登录页（携带回跳地址）
router.beforeEach((to) => {
  if (to.matched.some((record) => record.meta.requiresAuth)) {
    const auth = useAuthStore();
    if (!auth.isLoggedIn) {
      return { name: 'admin-login', query: { redirect: to.fullPath } };
    }
  }
  return true;
});

export default router;
