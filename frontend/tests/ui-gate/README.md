# 视觉回归闸门

判据是**计算样式 + 几何尺寸**，不是像素截图。

原因：本项目大量使用入场动画、滚动壁画、3 秒轮播、背景视频，像素比对在同一份代码上连拍两次都可能不同。而重构事故（样式被覆盖、断点错位、字号被继承顶掉、EP 按需后组件样式缺失）会先体现在计算样式和盒模型上——这两类数据可以做到零抖动。

## 用法

```bash
pnpm dev:api            # 必须先起后端：工具数据来自 API
pnpm dev:web            # 5173

cd frontend
pnpm gate               # 采集 + 与基线比对，有差异则 exit 1
pnpm gate:baseline      # 重建基线（仅在「改动就是期望」时用）
```

采集结果写入 `tests/ui-gate/.current/snapshot.json`，报告写入同目录 `report.md`。

需要人工看截图时：

```bash
node tests/ui-gate/capture.mjs --shots=../screenshots/phase2-after
```

## 覆盖范围

7 个页面 × 3 档视口（375 / 768 / 1440）× 每页 10–35 个选择器。

- `home`、四个工具页、`tool-missing`、`admin-login`
- 每个选择器记录：匹配节点数、`getBoundingClientRect`、31 项计算样式
- 同时记录文档级 `scrollWidth / scrollHeight / 横向溢出`

管理端登录页特意包含 `.el-input__wrapper`、`.el-button` 等 Element Plus 内部结构——EP 按需引入那一步，样式最容易塌在这里。

## 判定规则

| 类型 | 容差 |
|---|---|
| 几何（x/y/w/h） | 2px |
| 长度类样式（padding/font-size/gap…） | 0.5px |
| 颜色、字重、枚举值 | 精确匹配 |
| 节点数 | 精确匹配（防止重复渲染） |

刻意**不采集**：`background-image`（图片转 WebP 时会整体变化，属预期改动）、`box-shadow`、`transform`（受动画影响）。

## 确定性保障

1. `animation / transition` 全部置 `none`，采集的是动画结束后的稳态
2. 等 `document.fonts.ready` + 两帧 rAF + 120ms
3. 等 `.el-loading-mask` 消失——`v-loading` 会往目标元素写内联 `position/overflow`，遮罩未撤就采集会把加载态当基线（这是踩过的坑）
4. 拦截所有非本机请求，境外视频/CDN 字体不参与
5. 固定 `deviceScaleFactor: 1`、`zh-CN`、`dark`、`Asia/Shanghai`

自检过：同一份代码连采三次，差异为 0；注入 `.crumb { font-size: 15px }` 后产出 364 处差异并 exit 1，且无关页面为 0。

## 新增选择器

改 `config.mjs` 的 `PAGE_SELECTORS`，然后 `pnpm gate:baseline` 重建基线。
选择器优先取**语义稳定的类名**，别用 `:nth-child` 或依赖文案的结构——它们会因为内容变化产生假阳性。
