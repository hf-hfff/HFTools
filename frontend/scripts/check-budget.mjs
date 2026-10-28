// 构建产物体积守卫：`pnpm build` 末尾执行，任一指标超预算即 exit 1。
// 用法：node scripts/check-budget.mjs
//
// 预算不是行业标准，而是二期（C 按需引入 / D1 WebP / D2 壁画 / A 抽象 / B 视频）的实测值加一档余量。
// 拆成「首屏」与「全量」两层，因为两类回退的形态不同：
// - 首屏：重新 app.use(ElementPlus) 之类的地基回退，会让入口包从 150KB 直接顶到 1MB
// - 全量：新增工具/路由带来的分块膨胀，每加一个工具就悄悄多一块
// 首屏取 index.html 实际引用的资源（不是所有叫 index-*.js 的共享分块）；图片含 public/videos 的海报。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '../dist');

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else {
      files.push({
        rel: path.relative(DIST, full).replaceAll('\\', '/'),
        ext: path.extname(entry.name).toLowerCase(),
        size: statSync(full).size,
      });
    }
  }
})(DIST);

const kb = (list) => Math.round(list.reduce((acc, f) => acc + f.size, 0) / 1024);
const ofExt = (...exts) => files.filter((f) => exts.includes(f.ext));

// 入口包：只认 index.html 里真正引用的 script / stylesheet
const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');
const entryRefs = new Set([...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]));
const entryOf = (ext) => files.filter((f) => entryRefs.has(f.rel) && f.ext === ext);

const CHECKS = [
  { label: '首屏 JS（index.html 引用）', kb: kb(entryOf('.js')), limit: 250 },
  { label: '首屏 CSS（index.html 引用）', kb: kb(entryOf('.css')), limit: 80 },
  { label: '全量 JS', kb: kb(ofExt('.js')), limit: 900 },
  { label: '全量 CSS', kb: kb(ofExt('.css')), limit: 350 },
  { label: '图片（webp/jpg/png/svg）', kb: kb(ofExt('.webp', '.jpg', '.jpeg', '.png', '.gif', '.avif', '.svg')), limit: 900 },
];

const over = CHECKS.filter((c) => c.kb > c.limit);
for (const c of CHECKS) {
  console.log(`  ${c.kb > c.limit ? 'OVER' : ' ok '}  ${c.label}：${c.kb} KB / ${c.limit} KB`);
}

if (over.length) {
  console.error(`\n体积守卫失败：${over.map((c) => c.label).join('、')} 超出预算。`);
  console.error('若增长是有意的，先确认对应优化项是否需要重估，再调整本脚本的 CHECKS 数值。');
  process.exit(1);
}
