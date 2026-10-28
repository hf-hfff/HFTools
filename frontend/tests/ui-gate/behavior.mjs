/**
 * 行为探针：补上视觉闸门看不见的那一半。
 *
 * 视觉闸门只比「计算样式 + 几何」，抓不到「指令失效」「弹层没样式」这类问题——
 * 元素根本不存在时，闸门会如实记录 null，然后一声不响地通过。
 * Element Plus 改成按需引入后，这正是最危险的失败模式（v-loading 漏注册不报错）。
 *
 * 用法：node tests/ui-gate/behavior.mjs [--base=http://localhost:5173]
 * 退出码：0 全通过；1 有失败项
 */
import { chromium } from 'playwright-core';

const base = (process.argv.find((a) => a.startsWith('--base=')) ?? '').split('=')[1] || 'http://localhost:5173';

const results = [];
const errors = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` · ${detail}` : ''}\n`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail);
  } catch (err) {
    record(name, false, err.message);
  }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  colorScheme: 'dark',
});
// 境外视频不参与，避免无关噪音
await context.route('**/*', (route) => {
  const url = route.request().url();
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* data: */
  }
  const local = ['localhost', '127.0.0.1'].includes(host) || url.startsWith('data:');
  return local ? route.continue() : route.abort();
});

const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  // 探针主动 abort 了境外请求（背景视频），这不算页面缺陷
  if (/net::ERR_(FAILED|ABORTED)|Failed to load resource/.test(text)) return;
  errors.push(text);
});
page.on('pageerror', (err) => errors.push(String(err)));

process.stdout.write('\n[1] v-loading 指令\n');

await check('v-loading 遮罩出现且使用深色底', async () => {
  // 用「闸门」把接口挂住，而不是靠 sleep 猜时机：
  // 遮罩只在请求未完成时存在，睡短了会漏采，睡长了又不稳。
  // 注意必须按「端口 + 路径」精确匹配：glob `**/api/tools**` 会把
  // Vite 的模块地址 /src/api/tools.ts 一起拦住，页面直接挂不了载。
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.port === '3001' && url.pathname === '/api/tools',
    async (route) => {
      await gate;
      await route.continue().catch(() => {});
    },
  );

  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    const mask = page.locator('.el-loading-mask');
    // 数据未回来时 #tools 是空的，遮罩高度为 0，Playwright 的 visible 判据会认为不可见；
    // 这里只要求它已挂载，真正的判据是计算样式与宿主 position。
    await mask.waitFor({ state: 'attached', timeout: 10000 });
    const style = await mask.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, display: cs.display };
    });
    const pos = await page.locator('#tools').evaluate((el) => getComputedStyle(el).position);
    if (style.display === 'none') throw new Error('遮罩 display:none，v-loading 未生效');
    if (style.bg !== 'rgba(5, 5, 5, 0.72)') {
      throw new Error(`遮罩底色异常：${style.bg}（期望 rgba(5, 5, 5, 0.72)，来自 element-overrides.css）`);
    }
    if (pos !== 'relative') throw new Error(`#tools position=${pos}（v-loading 未生效时应为 static）`);
    release();
    await page.waitForSelector('.tool-card', { timeout: 15000 });
    return `底色 ${style.bg}，宿主 position=relative`;
  } finally {
    release();
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  }
});

process.stdout.write('\n[2] ElMessage 样式\n');

await check('登录失败时 ElMessage 有样式', async () => {
  await page.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.login-card');

  // 主题变量：按需引入后 base.css 可能排在我们的覆盖之后，
  // 只靠 :root 会输给同特异性的 EP 默认值（主色变蓝），这里守住结果。
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--el-color-primary').trim(),
  );
  if (primary !== '#4338ca') throw new Error(`--el-color-primary=${primary}（期望 #4338ca，被 base.css 顶掉）`);

  const inputs = page.locator('.login-card .el-input__inner');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('wrong-password');
  await page.locator('.login-button').click();

  const msg = page.locator('.el-message');
  await msg.first().waitFor({ state: 'visible', timeout: 8000 });
  const style = await msg.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      padding: cs.padding,
      font: cs.fontSize,
      text: el.textContent?.trim() ?? '',
    };
  });
  if (style.bg === 'rgba(0, 0, 0, 0)') throw new Error('消息背景透明：message 样式未加载');
  if (style.padding === '0px') throw new Error('消息无内边距：message 样式未加载');
  return `bg=${style.bg} padding=${style.padding} 文案「${style.text.slice(0, 12)}」`;
});

process.stdout.write('\n[3] 管理端表格与语言包\n');

await check('登录后表格、标签、开关正常且无英文残留', async () => {
  await page.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.login-card');
  const inputs = page.locator('.login-card .el-input__inner');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('admin123');
  await page.locator('.login-button').click();

  // SPA 跳转不走 document 级导航，waitForURL 的 load 事件等待不可靠，改为轮询地址
  for (let i = 0; i < 40 && !page.url().includes('/admin/tools'); i += 1) {
    await page.waitForTimeout(250);
  }
  if (!page.url().includes('/admin/tools')) {
    const msg = await page.locator('.el-message').allInnerTexts().catch(() => []);
    throw new Error(`未跳转到 /admin/tools，当前 ${page.url()}，提示 ${JSON.stringify(msg)}`);
  }
  await page.waitForSelector('.el-table__row', { timeout: 10000 });

  const rows = await page.locator('.el-table__row').count();
  if (rows === 0) throw new Error('表格无数据行');

  const tag = await page.locator('.el-table .el-tag').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, font: cs.fontSize };
  });
  if (tag.bg === 'rgba(0, 0, 0, 0)') throw new Error('el-tag 无背景：组件样式未加载');

  if ((await page.locator('.el-table .el-switch').count()) === 0) {
    throw new Error('el-switch 未渲染：启用开关失效');
  }

  // locale 丢失最典型的表现：EP 内置文案退回英文
  const body = await page.locator('.admin-main').innerText();
  const leaked = ['No Data', 'Loading', 'Total', 'Cancel', 'Confirm'].filter((t) => body.includes(t));
  if (leaked.length) throw new Error(`出现英文默认文案：${leaked.join(', ')}`);

  return `${rows} 行，tag bg=${tag.bg}，开关已渲染，无英文残留`;
});

process.stdout.write('\n[4] el-dialog 与遮罩层\n');

await check('模板弹窗可见且遮罩有底色', async () => {
  await page.goto(`${base}/tools/image-redraw`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tool-title');
  await page.locator('.prompt-tools .mini-btn').first().click();

  const dialog = page.locator('.el-dialog').first();
  await dialog.waitFor({ state: 'visible', timeout: 8000 });
  const box = await dialog.boundingBox();
  if (!box || box.width < 300) throw new Error(`弹窗尺寸异常：${JSON.stringify(box)}`);

  const overlayBg = await page
    .locator('.el-overlay')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  if (overlayBg === 'rgba(0, 0, 0, 0)') throw new Error('遮罩无底色：overlay 样式未加载');

  return `弹窗 ${Math.round(box.width)}×${Math.round(box.height)}，遮罩 ${overlayBg}`;
});

process.stdout.write('\n[5] ElMessageBox 样式（命令式 API）\n');

await check('message-box 样式已随命令式 API 引入', async () => {
  // 真实 confirm 需要历史记录非空，这里校验样式表是否命中该组件
  const probe = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'el-message-box';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = { bg: cs.backgroundColor, padding: cs.padding };
    el.remove();
    return out;
  });
  if (probe.bg === 'rgba(0, 0, 0, 0)' && probe.padding === '0px') {
    throw new Error('未命中 .el-message-box 样式：message-box/style/css 未引入');
  }
  return `bg=${probe.bg} padding=${probe.padding}`;
});

process.stdout.write('\n[6] 控制台错误\n');

await check('七个页面无控制台错误', async () => {
  errors.length = 0;
  const paths = [
    '/',
    '/tools/photo-review',
    '/tools/photo-enhance',
    '/tools/prompt-engineering',
    '/tools/image-redraw',
    '/admin/login',
    '/admin/tools',
  ];
  for (const p of paths) {
    await page.goto(`${base}${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  }
  if (errors.length) throw new Error(`${errors.length} 条：${errors.slice(0, 3).join(' | ')}`);
  return `7 个页面均无报错`;
});

await browser.close();

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${failed.length === 0 ? '全部通过' : `${failed.length} 项失败`}（${results.length} 项）\n`);
process.exit(failed.length === 0 ? 0 : 1);
