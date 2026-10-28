/**
 * 采集：逐页逐视口记录关键元素的几何尺寸与计算样式。
 *
 * 用法：
 *   node tests/ui-gate/capture.mjs                        # 写入 tests/ui-gate/.current
 *   node tests/ui-gate/capture.mjs --out=<dir>            # 指定输出目录
 *   node tests/ui-gate/capture.mjs --shots=<dir>          # 同时输出整页截图（仅作证据）
 *   node tests/ui-gate/capture.mjs --base=http://host:port
 */
import { chromium } from 'playwright-core';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BASE_URL,
  VIEWPORTS,
  PAGES,
  COMMON_SELECTORS,
  PAGE_SELECTORS,
  STYLE_PROPS,
} from './config.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const baseUrl = arg('base', BASE_URL);
const outDir = path.resolve(arg('out', 'tests/ui-gate/.current'));
const shotsDir = arg('shots', '') ? path.resolve(arg('shots', '')) : '';

/** 关闭动画与过渡：让「采集瞬间」等于「动画结束后的稳态」 */
const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  html { scroll-behavior: auto !important; }
`;

async function snapshotPage(page, selectors) {
  return page.evaluate(
    ({ selectors, props }) => {
      const round = (n) => Math.round(n * 100) / 100;
      const elements = {};

      for (const sel of selectors) {
        const nodes = document.querySelectorAll(sel);
        const el = nodes[0];
        if (!el) {
          elements[sel] = null;
          continue;
        }
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const styles = {};
        for (const prop of props) styles[prop] = cs[prop];
        elements[sel] = {
          count: nodes.length,
          rect: {
            x: round(rect.x),
            y: round(rect.y),
            width: round(rect.width),
            height: round(rect.height),
          },
          styles,
        };
      }

      const doc = document.documentElement;
      return {
        elements,
        doc: {
          clientWidth: doc.clientWidth,
          scrollWidth: doc.scrollWidth,
          scrollHeight: doc.scrollHeight,
          horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
        },
      };
    },
    { selectors, props: STYLE_PROPS },
  );
}

async function main() {
  // 先清空输出目录：否则采集中途失败时，上一轮的 snapshot.json 会被
  // diff 当成「本次结果」，闸门会静默给出假通过。
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  if (shotsDir) await mkdir(shotsDir, { recursive: true });

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const result = {
    meta: {
      baseUrl,
      capturedAt: new Date().toISOString(),
      browser: browser.version(),
      viewports: VIEWPORTS.map((v) => v.name),
      props: STYLE_PROPS,
    },
    pages: {},
  };

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        colorScheme: 'dark',
        reducedMotion: 'no-preference',
      });

      // 拦截外部请求：视频 / CDN 字体不应影响本轮测量的稳定性与速度。
      // 放行本机所有端口（dev server 5173 + API 3001），否则页面拿不到工具数据。
      await context.route('**/*', (route) => {
        const url = route.request().url();
        let hostname = '';
        try {
          hostname = new URL(url).hostname;
        } catch {
          /* data: / blob: 等 */
        }
        const local =
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          url.startsWith('data:') ||
          url.startsWith('blob:');
        return local ? route.continue() : route.abort();
      });

      const page = await context.newPage();

      for (const p of PAGES) {
        const url = `${baseUrl}${p.path}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        try {
          await page.waitForSelector(p.required, { timeout: 20000 });
        } catch {
          throw new Error(
            `页面未就绪：${p.name} (${p.path}) 未出现 ${p.required}。` +
              `请确认 dev server 与 API 均已启动，且工具数据已入库。`,
          );
        }

        await page.addStyleTag({ content: FREEZE_CSS });
        await page.evaluate(() => document.fonts.ready);
        // v-loading 指令会在目标元素上写内联 style（position/overflow），
        // 遮罩未撤干净就采集，会把「加载态」当成基线。必须等它消失。
        await page
          .waitForFunction(() => document.querySelectorAll('.el-loading-mask').length === 0, {
            timeout: 8000,
          })
          .catch(() => {});
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
        await page.waitForTimeout(120);

        const selectors = [...COMMON_SELECTORS, ...(PAGE_SELECTORS[p.name] ?? [])];
        result.pages[p.name] ??= {};
        result.pages[p.name][vp.name] = {
          url: p.path,
          ...(await snapshotPage(page, selectors)),
        };

        if (shotsDir) {
          await page.screenshot({
            path: path.join(shotsDir, `${p.name}@${vp.name}.png`),
            fullPage: false,
          });
        }
      }

      await context.close();
      process.stdout.write(`  ${vp.name}px 完成\n`);
    }
  } finally {
    await browser.close();
  }

  const file = path.join(outDir, 'snapshot.json');
  await writeFile(file, JSON.stringify(result, null, 2), 'utf8');
  process.stdout.write(`采集完成 → ${path.relative(process.cwd(), file)}\n`);
}

main().catch((err) => {
  process.stderr.write(`\n采集失败：${err.message}\n`);
  process.exit(1);
});
