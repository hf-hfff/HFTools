/**
 * 前端视觉回归闸门 · 配置
 *
 * 判据不是像素，而是「计算样式 + 几何尺寸」：
 * 动画、视频、轮播在像素比对里天然不稳定，而重构事故（样式覆盖失效、
 * 断点错位、字号被继承顶掉）恰恰会先体现在这两类数据上。
 *
 * 页面选择原则：覆盖所有「结构会被重构」的页面 + 一个管理端表单页
 * （EP 按需引入后，管理端是样式最容易塌的地方）。
 */

/** 被测地址；默认 Vite dev server */
export const BASE_URL = process.env.GATE_BASE_URL || 'http://localhost:5173';

/** 三档视口：手机 / 平板 / 桌面 */
export const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
];

/**
 * required：页面就绪锚点，同时充当「服务是否真的在跑」的断言。
 * 缺失即抛错，避免采集出一份「全是 404 空态」的假基线。
 */
export const PAGES = [
  { name: 'home', path: '/', required: '.tool-card' },
  { name: 'photo-review', path: '/tools/photo-review', required: '.tool-title' },
  { name: 'photo-enhance', path: '/tools/photo-enhance', required: '.tool-title' },
  { name: 'prompt-engineering', path: '/tools/prompt-engineering', required: '.tool-title' },
  { name: 'image-redraw', path: '/tools/image-redraw', required: '.tool-title' },
  { name: 'tool-missing', path: '/tool/not-exist', required: '.nf-code' },
  { name: 'admin-login', path: '/admin/login', required: '.login-card' },
];

/** 所有页面都量的选择器（不存在则记 null，不算失败） */
export const COMMON_SELECTORS = [
  'html',
  'body',
  '.topbar',
  '.brand',
  '.brand-name',
  '.topnav',
  '.topnav-link',
  '.user-layout .pill-nav',
  '.user-main',
  '.user-footer',
  '.foot-sub',
];

/** 按页面追加的选择器 */
export const PAGE_SELECTORS = {
  home: [
    '.home',
    '.hero',
    '.hero-inner',
    '.hero-eyebrow',
    '.headline',
    '.headline span',
    '.sub',
    '.hero-cta',
    '.strip',
    '.strip-item',
    '.sections',
    '.category',
    '.eyebrow',
    '.category-title',
    '.category-desc',
    '.card-grid',
    '.tool-card',
    '.tool-name',
    '.tool-status',
  ],
  'photo-review': [
    '.tool-page',
    '.crumb',
    '.tool-header',
    '.tool-icon',
    '.tool-title',
    '.back-btn',
    '.review-layout',
    '.input-panel',
    '.upload-panel',
    '.dropzone',
    '.dz-title',
    '.dz-desc',
    '.note-field',
    '.note-input',
    '.note-count',
    '.submit-btn',
    '.result-panel',
    '.result-empty',
    '.re-title',
    '.re-desc',
    '.ai-disclaimer',
    '.photo-wall',
    '.wall-veil',
  ],
  'photo-enhance': [
    '.tool-page',
    '.crumb',
    '.tool-header',
    '.tool-icon',
    '.tool-title',
    '.back-btn',
    '.input-layout',
    '.panel',
    '.upload-panel',
    '.dropzone',
    '.dz-title',
    '.submit-btn',
    '.work-panel',
    '.work-empty',
    '.we-title',
    '.we-desc',
    '.ai-disclaimer',
    '.photo-wall',
    '.wall-veil',
  ],
  'prompt-engineering': [
    '.tool-page',
    '.tool-page-content',
    '.crumb',
    '.tool-header',
    '.tool-icon',
    '.tool-title',
    '.back-btn',
    '.input-panel',
    '.draft-input',
    '.draft-count',
    '.submit-btn',
    '.result-panel',
    '.result-empty',
    '.re-title',
    '.re-desc',
    '.example-grid',
    '.example-card',
    '.ai-disclaimer',
    '.page-background-mask',
  ],
  'image-redraw': [
    '.tool-page',
    '.redraw-shell',
    '.crumb',
    '.tool-header',
    '.tool-icon',
    '.tool-title',
    '.tool-sub',
    '.back-btn',
    '.input-layout',
    '.panel',
    '.prompt-input',
    '.submit-btn',
    '.submit-hint',
    '.disclaimer',
    '.result-panel',
  ],
  'tool-missing': [
    '.tool-page',
    '.tool-content',
    '.crumb',
    '.tool-header',
    '.tool-title',
    '.notfound',
    '.nf-code',
    '.nf-title',
    '.nf-desc',
    '.wip-panel',
  ],
  'admin-login': [
    '.login-page',
    '.login-card',
    '.login-header',
    '.login-title',
    '.login-sub',
    '.login-button',
    // EP 内部结构：按需引入后最容易塌的地方
    '.el-input',
    '.el-input__wrapper',
    '.el-input__inner',
    '.el-button',
    '.el-form-item',
    '.el-form-item__label',
  ],
};

/**
 * 采集的属性：只取「布局 + 排版 + 颜色」三类。
 * 刻意不含 background-image / box-shadow / transform：
 * 前者在图片转 WebP 时会整体变化（那是预期改动），后两者受动画影响。
 */
export const STYLE_PROPS = [
  'display',
  'position',
  'width',
  'height',
  'maxWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'color',
  'backgroundColor',
  'borderTopWidth',
  'borderTopColor',
  'borderRadius',
  'gap',
  'flexDirection',
  'alignItems',
  'justifyContent',
  'gridTemplateColumns',
  'opacity',
  'overflow',
  'whiteSpace',
];

/** 几何容差（px）：低于这个值视为子像素抖动 */
export const RECT_TOLERANCE = 2;

/** 数值型样式容差（px） */
export const NUMBER_TOLERANCE = 0.5;
