import { defineStore } from 'pinia';

/** JWT 在 localStorage 中的键名 */
export const TOKEN_KEY = 'hftools_admin_token';

/**
 * 管理员鉴权状态：token 持久化到 localStorage
 * 用户端无需登录，仅管理平台使用
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY),
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.token),
  },
  actions: {
    /** 登录成功后保存 token */
    setToken(token: string) {
      this.token = token;
      localStorage.setItem(TOKEN_KEY, token);
    },
    /** 退出登录 / 401 失效时清除 token */
    clearToken() {
      this.token = null;
      localStorage.removeItem(TOKEN_KEY);
    },
  },
});
