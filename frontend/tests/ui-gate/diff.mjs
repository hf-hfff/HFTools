/**
 * 比对：基线 vs 本次采集，输出可读差异报告。
 *
 * 用法：
 *   node tests/ui-gate/diff.mjs
 *   node tests/ui-gate/diff.mjs <baselineDir> <currentDir>
 *
 * 退出码：0 = 无差异；1 = 有差异（可直接用于 CI 门禁）
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RECT_TOLERANCE, NUMBER_TOLERANCE } from './config.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const baselineDir = path.resolve(args[0] ?? 'tests/ui-gate/baseline');
const currentDir = path.resolve(args[1] ?? 'tests/ui-gate/.current');

const NUMERIC = /^-?\d+(\.\d+)?(px)?$/;

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && NUMERIC.test(value)) return parseFloat(value);
  return null;
}

/** 单值比较：数值走容差，其余精确匹配 */
function compareValue(key, base, cur, tolerance) {
  if (base === cur) return null;
  const b = toNumber(base);
  const c = toNumber(cur);
  if (b !== null && c !== null) {
    if (Math.abs(b - c) <= tolerance) return null;
    return { key, base, cur, delta: Math.round((c - b) * 100) / 100 };
  }
  return { key, base, cur };
}

function compareElement(sel, base, cur) {
  const diffs = [];

  if (!base && !cur) return diffs;

  if (base && !cur) {
    diffs.push({ selector: sel, kind: '元素消失', detail: '基线存在，本次未找到' });
    return diffs;
  }
  if (!base && cur) {
    diffs.push({ selector: sel, kind: '元素新增', detail: '基线不存在，本次出现' });
    return diffs;
  }

  if (base.count !== cur.count) {
    diffs.push({
      selector: sel,
      kind: '节点数变化',
      detail: `${base.count} → ${cur.count}`,
    });
  }

  for (const axis of ['x', 'y', 'width', 'height']) {
    const d = compareValue(axis, base.rect[axis], cur.rect[axis], RECT_TOLERANCE);
    if (d) {
      diffs.push({
        selector: sel,
        kind: '几何',
        detail: `${axis}: ${d.base} → ${d.cur}` + (d.delta !== undefined ? ` (${d.delta > 0 ? '+' : ''}${d.delta})` : ''),
      });
    }
  }

  const keys = new Set([...Object.keys(base.styles), ...Object.keys(cur.styles)]);
  for (const key of keys) {
    const b = base.styles[key];
    const c = cur.styles[key];
    if (b === c) continue;
    // 颜色是整串字符串，容差 0；长度类数值走 0.5px
    const tolerance = /color|Color$|Weight$/.test(key) ? 0 : NUMBER_TOLERANCE;
    const d = compareValue(key, b, c, tolerance);
    if (d) {
      diffs.push({
        selector: sel,
        kind: '样式',
        detail: `${key}: ${d.base} → ${d.cur}`,
      });
    }
  }

  return diffs;
}

async function load(dir) {
  const file = path.join(dir, 'snapshot.json');
  const raw = await readFile(file, 'utf8');
  return { file, data: JSON.parse(raw) };
}

function render(report) {
  const lines = [];
  lines.push('# 视觉回归报告', '');
  lines.push(`- 基线：\`${path.relative(process.cwd(), report.baselineFile)}\``);
  lines.push(`- 本次：\`${path.relative(process.cwd(), report.currentFile)}\``);
  lines.push(`- 差异总数：**${report.total}**`, '');

  if (report.total === 0) {
    lines.push('无差异。');
    return lines.join('\n');
  }

  lines.push('| 页面 | 视口 | 差异数 |');
  lines.push('|---|---|---|');
  for (const page of report.pages) {
    for (const vp of page.viewports) {
      lines.push(`| ${page.name} | ${vp.name}px | ${vp.count} |`);
    }
  }
  lines.push('');

  for (const page of report.pages) {
    for (const vp of page.viewports) {
      if (vp.count === 0) continue;
      lines.push(`## ${page.name} @ ${vp.name}px`, '');
      if (vp.doc.length) {
        lines.push('**文档级**', '');
        for (const d of vp.doc) lines.push(`- ${d}`);
        lines.push('');
      }
      for (const el of vp.elements) {
        lines.push(`**\`${el.selector}\`**`, '');
        for (const d of el.diffs) lines.push(`- ${d.kind}：${d.detail}`);
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}

async function main() {
  const baseline = await load(baselineDir);
  const current = await load(currentDir);

  const pages = [];
  let total = 0;

  const pageNames = new Set([
    ...Object.keys(baseline.data.pages),
    ...Object.keys(current.data.pages),
  ]);

  for (const name of pageNames) {
    const viewports = [];
    const basePage = baseline.data.pages[name] ?? {};
    const curPage = current.data.pages[name] ?? {};
    const vpNames = new Set([...Object.keys(basePage), ...Object.keys(curPage)]);

    for (const vpName of vpNames) {
      const baseVp = basePage[vpName];
      const curVp = curPage[vpName];
      const doc = [];

      if (!baseVp || !curVp) {
        doc.push(`整页缺失：基线${baseVp ? '有' : '无'} / 本次${curVp ? '有' : '无'}`);
        viewports.push({ name: vpName, count: 1, doc, elements: [] });
        total += 1;
        continue;
      }

      for (const key of ['clientWidth', 'scrollWidth', 'scrollHeight']) {
        const d = compareValue(key, baseVp.doc[key], curVp.doc[key], RECT_TOLERANCE);
        if (d) doc.push(`${key}: ${d.base} → ${d.cur}`);
      }
      if (baseVp.doc.horizontalOverflow !== curVp.doc.horizontalOverflow) {
        doc.push(
          `横向溢出: ${baseVp.doc.horizontalOverflow ? '有' : '无'} → ${
            curVp.doc.horizontalOverflow ? '有' : '无'
          }`,
        );
      }

      const selectors = new Set([
        ...Object.keys(baseVp.elements),
        ...Object.keys(curVp.elements),
      ]);
      const elements = [];
      let vpCount = doc.length;

      for (const sel of selectors) {
        const diffs = compareElement(sel, baseVp.elements[sel], curVp.elements[sel]);
        if (diffs.length) {
          elements.push({ selector: sel, diffs });
          vpCount += diffs.length;
        }
      }

      total += vpCount;
      viewports.push({ name: vpName, count: vpCount, doc, elements });
    }

    pages.push({ name, viewports });
  }

  const report = {
    baselineFile: baseline.file,
    currentFile: current.file,
    total,
    pages,
  };

  const md = render(report);
  await writeFile(path.join(currentDir, 'report.md'), md, 'utf8');
  process.stdout.write(`${md}\n`);

  if (total > 0) {
    process.stderr.write(`\n发现 ${total} 处差异。报告：${path.join(currentDir, 'report.md')}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`\n比对失败：${err.message}\n`);
  process.exit(2);
});
