// 背景视频本地化：把仓库根 assets-src/prompt-bg.mp4 转成自托管资产
// 产物：frontend/public/videos/prompt-bg-720.mp4（桌面档）、prompt-bg-540.mp4（≤900px 档）、
//      prompt-bg-poster.webp（首帧海报，preload=none 与加载失败时的兜底画面）
// 用法：pnpm media:video（需先把原片放到 assets-src/prompt-bg.mp4，该目录不入库）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const src = path.join(root, 'assets-src/prompt-bg.mp4');
const outDir = path.join(root, 'frontend/public/videos');

if (!existsSync(src)) {
  console.error(`[media:video] 缺少源文件：${src}\n请先下载原片到 assets-src/prompt-bg.mp4`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

/** 视频档位：无音轨、24fps、faststart（边下边播，避免整段缓冲后才出画面） */
const videoJobs = [
  {
    name: 'prompt-bg-720.mp4',
    args: [
      '-an',
      '-vf',
      'scale=1280:-2,fps=24',
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-crf',
      '31',
      '-preset',
      'slow',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
    ],
  },
  {
    name: 'prompt-bg-540.mp4',
    args: [
      '-an',
      '-vf',
      'scale=854:-2,fps=24',
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-crf',
      '32',
      '-preset',
      'slow',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
    ],
  },
];

/** 海报：取第 1 秒的一帧，避开片头可能的黑场 */
const posterName = 'prompt-bg-poster.webp';

for (const job of videoJobs) {
  const out = path.join(outDir, job.name);
  const res = spawnSync(ffmpegPath, ['-y', '-i', src, ...job.args, out], { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const posterOut = path.join(outDir, posterName);
const posterRes = spawnSync(
  ffmpegPath,
  [
    '-y',
    '-ss',
    '1',
    '-i',
    src,
    '-frames:v',
    '1',
    '-vf',
    'scale=1280:-2',
    '-c:v',
    'libwebp',
    '-quality',
    '80',
    posterOut,
  ],
  { stdio: 'inherit' },
);
if (posterRes.status !== 0) process.exit(posterRes.status ?? 1);

for (const name of [...videoJobs.map((j) => j.name), posterName]) {
  const kb = (statSync(path.join(outDir, name)).size / 1024).toFixed(1);
  console.log(`[media:video] ${name}  ${kb} KB`);
}
