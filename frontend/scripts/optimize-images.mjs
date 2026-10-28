// 一次性图片优化脚本：把 jpg 素材转成 WebP，供 import.meta.glob 与 CSS 引用。
// 用法：node scripts/optimize-images.mjs
// 只读原图、只写 .webp，不删除任何源文件；替换引用并验证后再人工清理原图。
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');

/** 各目录的目标宽度与质量：宽度取实际渲染宽度的 2 倍，超过原图则不放大 */
const JOBS = [
  { dir: 'src/assets/bg-photos', width: 640, quality: 72 },
  { dir: 'src/assets/redraw-mural', width: 520, quality: 70 },
];

/** 单文件任务：hero 需要移入 src/assets 才能拿到内容哈希 */
const SINGLE = [
  { from: 'public/images/portal_scene.jpg', to: 'src/assets/portal_scene.webp', width: 1920, quality: 80 },
];

async function toWebp(input, output, width, quality) {
  const image = sharp(input).rotate();
  const meta = await image.metadata();
  const target = Math.min(width, meta.width ?? width);
  await image
    .resize({ width: target, withoutEnlargement: true })
    .webp({ quality, effort: 6 })
    .toFile(output);
  const [srcSize, outSize] = await Promise.all([stat(input), stat(output)]);
  return {
    name: parse(output).base,
    from: `${Math.round(srcSize.size / 1024)}KB`,
    to: `${Math.round(outSize.size / 1024)}KB`,
    width: target,
  };
}

const rows = [];
for (const job of JOBS) {
  const dir = join(ROOT, job.dir);
  const files = (await readdir(dir)).filter((f) => /\.jpe?g$/i.test(f)).sort();
  for (const file of files) {
    rows.push(await toWebp(join(dir, file), join(dir, parse(file).name + '.webp'), job.width, job.quality));
  }
}
for (const item of SINGLE) {
  if (!existsSync(join(ROOT, item.from))) continue;
  rows.push(await toWebp(join(ROOT, item.from), join(ROOT, item.to), item.width, item.quality));
}

const totalFrom = rows.reduce((sum, r) => sum + Number.parseInt(r.from, 10), 0);
const totalTo = rows.reduce((sum, r) => sum + Number.parseInt(r.to, 10), 0);
for (const r of rows) console.log(`${r.name.padEnd(30)} ${r.from.padStart(6)} → ${r.to.padStart(5)}  (w=${r.width})`);
console.log(`\n合计 ${rows.length} 张：${totalFrom}KB → ${totalTo}KB`);
