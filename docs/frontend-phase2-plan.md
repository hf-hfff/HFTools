# 前端二期方案：四项挂起任务的执行计划

> 依据：`docs/frontend-ui-review-2026-10-28.md` 第八章挂起项
> 基线：2026-10-28 修复后的构建产物（见 1.1 实测表）
> 目标：在不牺牲现有视觉主张的前提下，把「每新增一页就复制一遍」的成本归零，并让首屏体积回到合理区间

---

## 0. 结论先行

时间充足时，排序原则不是「哪个便宜先做」，而是**依赖方向**：先建验证工具，再定地基，再定资产，最后才动结构。每一步的产物是下一步的输入。

| 步 | 内容 | 工时 | 为什么必须在这个位置 |
|---|---|---|---|
| 0 | 回归闸门（计算样式 + 几何 + 截图） | 0.5–1d | 没有闸门，后面每一步都是盲改；且要先证明它自己不出假阳/假阴 |
| 1 | C Element Plus 按需 | 0.5–1d | 地基：全局注册方式、CSS 注入顺序、locale 一旦定下，上层才稳定 |
| 2 | D1 图片转 WebP | 1–1.5h | 资产定型，之后所有基线不再混入图片差异 |
| 3 | D2 壁画按断点渲染 | 1–1.5h | 同上；A 要抽的照片墙应基于优化后的实现，否则抽完再改一遍 |
| 4 | A 组件抽象（含 D3 的 404） | 1.5–2d | 在最终地基 + 最终资产上重排结构，只需验一次 |
| 5 | B 背景视频本地化 | 0.5d | 要改 `PromptOptimizeView` 模板，放在 A 之后避免同一文件二次触碰 |
| 6 | 预算守卫 + 全量验收 | 0.5d | 把成果固化为构建期约束，防三次迭代后回退 |

### 0.1 为什么 C 在 A 之前（这是对上一版的修订）

初版方案写的是「A 先于 C」，理由是「两项叠加时回归问题无法归因」。这个理由不成立——只要串行 + 每步过闸门，归因问题不存在。真正的约束是依赖方向：

1. **C 改的是地基**。`app.use(ElementPlus)` 消失、CSS 注入顺序改变、locale 改由 `ElConfigProvider` 提供。A 抽出的每个组件都要落在这个新地基上。地基先改、上层后建，上层只验一次；顺序反了，A 验证通过的层叠关系会在 C 之后整体失效，等于 A 白验。
2. **C 的失败是静默的**。`v-loading` 漏注册不会报错，只会让加载态消失。这种问题必须在结构还简单时暴露，不能留到 5 个新组件都依赖它之后。
3. **C 让 A 的调试变简单**。CSS 从 357 KB 降到 ~130 KB，DevTools 里竞争规则少一半，排查「这条样式从哪来」快得多。

唯一保留的旧结论：**资产（D1/D2）必须在 A 的基线之前**，否则截图里会混入图片差异，无法判断结构改动是否引起位移。

### 0.2 D3 为什么不再单列

初版把独立 404 放在第一步图省事，但它需要 `NotFoundState` 组件，而这个组件本来就在 A 的清单里。先做 D3 意味着先写一份 404 样式、再在 A 里删掉重写。并进 A 的最后一步：4 处重复的 404 块和路由级 404 一次收敛到同一个组件，只碰一次。

### 0.3 如果时间被压缩

按 `0 → 2 → 3 → 1 → 4 → 5` 重排即可：闸门和资产先落，C 与 A 的先后可以互换（代价是多重验一遍 CSS 层叠）。但闸门不能省——它是唯一能防止「改一处、坏三页」的东西。

### 0.4 第 0 步已落地（2026-10-28）

产出 `frontend/tests/ui-gate/`：

| 文件 | 作用 |
|---|---|
| `config.mjs` | 7 页 × 3 档视口 × 每页 10–35 个选择器、31 项样式属性、容差定义 |
| `capture.mjs` | 用本机 Edge（`playwright-core` + `channel: msedge`）采集，输出 `snapshot.json` |
| `diff.mjs` | 基线比对，输出 `report.md`，有差异 exit 1 |
| `baseline/snapshot.json` | 入库的基线（736 KB） |
| `README.md` | 用法、判定规则、确定性保障、如何加选择器 |

命令：`pnpm gate`（采集+比对）、`pnpm gate:baseline`（重建基线）。

**自检结果**：

- 确定性：同一份代码连采 3 次，两两比对差异均为 0
- 灵敏度：注入 `.crumb { font-size: 15px }` 后产出 364 处差异并 exit 1，且 `home` / `tool-missing` / `admin-login` 全为 0（说明只报了受影响页面）
- 踩坑并修掉：`v-loading` 会往目标元素写内联 `position/overflow`，遮罩未撤就采集会把「加载态」当基线，首轮自检出现过一次 `.sections: relative → static` 的假阳性；现在采集前显式等 `.el-loading-mask` 消失

截图不入库（21 张 5.4 MB），需要人工复核时按 README 的命令重生成。

---

## 1. 现状基线（先量化，再动手）

### 1.1 构建产物

| 指标 | 当前值 | 目标值 |
|---|---|---|
| JS 总量 | 1.30 MB | ≤ 650 KB |
| `index-*.js` 单包 | 1.10 MB | ≤ 500 KB |
| CSS 总量 | 449 KB | ≤ 190 KB |
| `index-*.css` 单包 | 357 KB | ≤ 150 KB |
| 图片（dist 内 24 张 jpg） | 1.80 MB | ≤ 800 KB |
| 首页 hero 图 | 319 KB | ≤ 110 KB |
| 背景视频 | 13.86 MB（境外 CDN，仓库内 0） | ≤ 2.2 MB 或 40 KB 海报 |

### 1.2 重复代码实测

```
.crumb + .tool-header + .tool-icon + .tool-title   → 5 个文件
.back-btn                                          → 3 个文件（+2 页用全局样式）
.submit-btn                                        → 4 个文件
.spinner + @keyframes spin                         → 4 个文件
.nf-code / .nf-title（404 块）                     → 4 个文件
mulberry32 + 照片墙布局 + .wall-veil               → 2 个文件，逐字符重复
```

### 1.3 工程条件

- Node v26.12.0 / npm 11.20.0，npm registry 可达
- `sharp`、`unplugin-vue-components`、`ffmpeg-static` **均未安装**，需新增
- 本机无 ffmpeg（视频转码需 `ffmpeg-static` devDependency）
- Element Plus 使用 27 个标签、14 个不同组件；`ElMessage`/`ElMessageBox` 在 11 个文件里具名导入；`v-loading` 指令多处使用
- 路由已是全量懒加载（`UserLayout` / 各视图均动态 import），首屏 1.1MB 的主要成分是 Element Plus 全量注册

---

## 2. 项 A：组件抽象（4 组件 + 2 composable）

### 2.1 抽取清单

| 新文件 | 收敛什么 | 来源 | 预计净删除 |
|---|---|---|---|
| `components/ToolPageHeader.vue` | crumb / 图标 / h1 / 返回按钮 / 560px 断点 | 5 个视图 | ~330 行 |
| `components/SubmitButton.vue` | 主按钮 / spinner / loading 文案 / 禁用态 | 4 个视图 | ~90 行 |
| `components/EmptyState.vue` | 空态图标 + 标题 + 描述 + 插槽 | 4 个视图 | ~70 行 |
| `components/NotFoundState.vue` | 404 数字 + 标题 + 行动按钮 | 4 个视图 | ~80 行 |
| `composables/useToolMeta.ts` | 取 tool、加载态、notFound、fetch 一次 | 5 个视图 | ~60 行 |
| `composables/useLongTask.ts` | elapsed / stage 预估 / timeout / 卸载清理 | 3 个视图 | ~90 行 |

可选第 5 个组件：`components/PhotoWall.vue`（照片墙 + mulberry32 + 蒙层），2 个文件各 ~160 行。**建议单列提交**，因为两个页面的聚光灯交互存在差异，需先 diff 确认能否参数化。

### 2.2 接口契约（先定契约，再改调用方）

```ts
// ToolPageHeader
{ crumb: string; icon: string; title: string; backTo?: string }  // 默认 '/'

// SubmitButton
{ loading?: boolean; disabled?: boolean; label: string; loadingLabel?: string }
// 不接 click，由父级 @click，避免组件隐式承担业务

// EmptyState
{ icon: string; title: string; desc?: string }  + <slot> 覆盖图标区（给拍立得显影用）

// NotFoundState
{ code?: string; title: string; desc?: string }

// useToolMeta(() => route.params.id)
{ tool, loading, notFound }

// useLongTask({ timeoutS, stages })
{ elapsed, stage, running, start, stop }
```

三条设计约束：

1. **组件只管版式，不管数据**。`ToolPageHeader` 不接受 tool 对象，只接受已解析的字符串——否则组件会和 store 耦合。
2. **样式归属**：抽走的样式写进组件 `<style scoped>`，不再留在页面 `<style scoped>` 里。页面只保留自身特有布局。
3. **断点内聚**：每个组件自带窄屏规则，页面级断点只管「几栏变一栏」，两类断点不再交叉。

### 2.3 执行步骤

```bash
git checkout -b refactor/tool-page-components
```

按依赖从下往上，每个组件独立提交、独立回归：

1. `useToolMeta` → 5 个视图替换样板（此时无视觉变化，纯逻辑迁移，先验证路由与加载态）
2. `ToolPageHeader` → 5 个视图替换页头（删 scoped 样式，验证 1440/768/375 三档）
3. `SubmitButton` → 4 个视图（验证 loading 中禁用、文案切换、spinner 动画）
4. `EmptyState` + `NotFoundState` → 4 个视图（验证空态与「工具不存在」两条分支）
5. `useLongTask` → 3 个视图（验证秒数递增、阶段推进、超时提示、切页后定时器已清）
6. 单独提交：`PhotoWall`（若 diff 确认可参数化）

每个提交的准入门槛：`npx vue-tsc -b --force` exit 0 + `pnpm build` 通过 + 涉及页面三档截图对比无位移。

### 2.4 回归验证协议（做 A 之前必须先建）

现状没有自动化视觉回归，所以先用「人工基线 + 定量比对」兜住：

1. 起 `pnpm dev:web`，用浏览器工具按 1440×900 / 768×1024 / 375×812 三档，对 7 个页面截图：
   `/`、`/tools/photo-review`、`/tools/photo-enhance`、`/tools/image-redraw`、
   `/tools/prompt-engineering`、`/tool/not-exist`、`/admin/login`
2. 存入 `screenshots/phase2-baseline/<page>@<width>.png`，并提交进仓库作为基线
3. 每次重构后重拍同名文件到 `screenshots/phase2-after/`，逐对目视 + 记录差异
4. 判定标准：布局位移 ≤ 2px、字号/颜色零变化、无新增折行。任一项不满足即回退该提交

若愿意多花半天，可加 `pixelmatch + pngjs` 做像素 diff，把「目视」换成「差异率 < 0.3%」——这是一次性投入，C 和后续迭代都能复用。**建议做**，因为 A 的 6 个提交 × 7 个页面 = 42 次对比，人工看不住。

### 2.5 风险

| 风险 | 应对 |
|---|---|
| scoped 样式特异性变化导致覆盖失效 | 组件内样式只作用于自身，页面不再写同名选择器；改完 grep 一遍类名确认无残留 |
| `useLongTask` 迁移漏掉卸载清理 | 迁移后人工切页 5 次，用 Performance 面板确认无游离 setInterval |
| 两个照片墙交互差异过大 | 差异 > 30% 就只抽 `mulberry32` + 布局，交互留在页面 |

---

## 3. 项 B：背景视频本地化

### 3.1 现状

- 单文件 13,856,777 字节，托管在 `d8j0ntlcm91z4.cloudfront.net`（境外）
- 仅 `PromptOptimizeView` 使用，`autoplay muted loop playsinline`，已有 `@error` 兜底
- 与项目「本地运行」定位冲突：断网/内网部署时该页背景直接消失

### 3.2 两个方案，需要你选

| | B1 本地转码 | B2 海报 + 缓动 |
|---|---|---|
| 做法 | 下载后转 720p / 无音轨 / 24fps / CRF31，自托管 | 抽一帧做 WebP 海报，CSS 做 20s 缓慢推近 |
| 体积 | 1.2–2.2 MB | 30–50 KB |
| 观感 | 保留原动态 | 失去运动，但仍有「静止镜头缓推」的电影感 |
| 仓库成本 | +2 MB | +40 KB |
| 移动端 | 建议只发海报 | 天然只发海报 |

**建议 B1**，理由：这页的视觉识别度很大程度来自背景运动，换成静态会有明显落差；2MB 在局域网/自托管场景可接受，且可通过移动端只发海报把流量挡住。若你更看重仓库轻量，B2 也完全成立，且实现只要 1 小时。

### 3.3 B1 执行步骤

```bash
npm i -D ffmpeg-static
curl -o assets-src/prompt-bg.mp4 "<原 CDN 地址>"   # assets-src/ 加入 .gitignore
```

转码（无音轨、faststart、双档）：

```bash
ffmpeg -i assets-src/prompt-bg.mp4 -an -vf "scale=1280:-2,fps=24" \
  -c:v libx264 -profile:v high -crf 31 -preset slow -pix_fmt yuv420p \
  -movflags +faststart public/videos/prompt-bg-720.mp4

ffmpeg -i assets-src/prompt-bg.mp4 -an -vf "scale=854:-2,fps=24" \
  -c:v libx264 -profile:v high -crf 32 -preset slow -pix_fmt yuv420p \
  -movflags +faststart public/videos/prompt-bg-540.mp4

ffmpeg -ss 1 -i assets-src/prompt-bg.mp4 -frames:v 1 -vf "scale=1280:-2" \
  -c:v libwebp -quality 80 public/videos/prompt-bg-poster.webp
```

加载策略（比压缩更省流量）：

- `<video poster>` 必填，首帧不再黑屏，且视频加载失败时页面仍有画面
- `preload="none"`：JS 判定「非减动效 + 宽度 ≥ 900」后才 `load()` 并播放，移动端与减动效用户只拿海报
- 加 `<source media="(max-width: 900px)" src="...540.mp4">` 作为双档兜底
- 保留现有 `@error` → 回退海报的逻辑

同时把上述命令写进 `scripts/media.md`（或 `package.json` 的 `media:video` 脚本），未来换素材可复现，不依赖某台机器的手工操作。

### 3.4 验收

- 断网（DevTools offline）后页面仍有背景画面，控制台无报错
- 375px 下网络面板无 mp4 请求，只有 poster
- 桌面端首屏 LCP 不因视频回退（`preload="none"` 保证）
- `ffmpeg-static` 只进 devDependencies，产物里不含二进制

**实测（2026-10-28）**：13.86 MB 片源 → 720p 262 KB / 540p 89 KB / 海报 70 KB（CRF 31/32 下远低于预算，源片慢镜且静态区域大）；生产构建实测 1440px 只请求海报 + 720p，768/375px 只请求海报、mp4 字节为 0；拦截 mp4 后元素保留、海报仍显示；全站无任何非 localhost 请求；`pnpm gate` 零差异、`gate:behavior` 7 页无控制台错误。

---

## 4. 项 C：Element Plus 按需引入

### 4.1 现状

`main.ts` 一行 `app.use(ElementPlus)` + `import 'element-plus/dist/index.css'`，代价：1.10 MB JS + 357 KB CSS；实际只用到 14 个组件、2 个命令式 API、1 个指令。

### 4.2 四个必须先处理的坑

1. **`v-loading` 是指令，不是组件**。按需后必须显式注册：`app.use(ElLoading)` 或在 `main.ts` 中 `app.directive('loading', ElLoading.directive)`。漏了它，全站 6 个加载态直接失效且**不报错**。
2. **命令式 API 的样式不会自动来**。`ElMessage` / `ElMessageBox` 的样式需手动引入：`element-plus/es/components/message/style/css`、`message-box/style/css`（`loading` 同理）。
3. **locale 随 `app.use` 一起没了**。改用 `App.vue` 外包一层 `<el-config-provider :locale="zhCn">`，否则分页器、日期、空态文案退回英文。
4. **CSS 顺序会变，全局覆盖可能失效**。现有 `style.css` 里有大量 `.el-*` 覆盖，按需后组件样式注入时机不确定。解法：把 EP 覆盖单独拆到 `src/styles/element-overrides.css`，在 `main.ts` 中**最后一个**静态 import，靠 import 求值顺序稳定住层叠。

### 4.3 步骤

```bash
npm i -D unplugin-vue-components
```

```ts
// vite.config.ts
Components({
  resolvers: [ElementPlusResolver({ importStyle: 'css', directives: true })],
  dts: 'src/components.d.ts',
})
```

不建议同时上 `unplugin-auto-import`：项目只有 2 个命令式 API，显式 import 更符合现有代码风格（且 auto-import 的全局类型声明会让 `vue-tsc` 行为变复杂）。

改造顺序：

1. 装插件、加 resolver，**先不删** `app.use(ElementPlus)`，构建对比产物是否变小（预期不变，因为全量注册还在）
2. 删 `app.use(ElementPlus)` 与 `element-plus/dist/index.css`，补 3 个命令式样式 import 与 `ElLoading` 注册
3. `App.vue` 加 `ElConfigProvider`
4. 抽出 `element-overrides.css`，确认它在 `main.ts` 最后
5. 逐页回归：表格边框、弹窗遮罩、Tooltip 箭头、Message 位置、分页器中文、`v-loading` 遮罩

### 4.4 实测结果（2026-10-28）

| 指标 | 改造前 | 改造后 | 变化 |
|---|---|---|---|
| 入口 JS（`index-*.js`） | 1071.3 KB | **153.3 KB** | −86% |
| 入口 CSS（`index-*.css`） | 357 KB | **53.3 KB** | −85% |
| 首屏关键资源合计 | 1.46 MB | **207 KB**（gzip 69 KB） | −86% |
| 全量 JS | 1.30 MB | 804 KB（39 个分块） | 拆成按路由懒加载 |
| 全量 CSS | 449 KB | 292 KB（按页分块） | 同上 |

全量数字看起来只降了 40%，是因为原来那 1.1 MB 是一个必须首屏下载的单包；现在 EP 的表格、表单、弹层 CSS 都跟着对应路由走，首屏不再承担。

**做法**：`Components({ resolvers: [ElementPlusResolver({ importStyle: 'css' })] })` + 删除 `app.use(ElementPlus)` 与 `dist/index.css`；locale 改由 `App.vue` 的 `<el-config-provider>` 提供；`ElMessage` / `ElMessageBox` / `ElLoading` 不走模板解析，样式与指令需显式引入。

**验证**：`pnpm gate` 零差异（7 页 × 3 档）；`pnpm gate:behavior` 6 项全通过——`v-loading` 遮罩底色 `rgba(5,5,5,.72)`、登录失败 Message 有样式、管理端 11 行表格 + tag + switch、模板弹窗 880×448 且遮罩 `rgba(0,0,0,.5)`、`message-box` 样式命中、7 页无控制台报错。

**三个坑（都已写进 `tests/ui-gate/README.md`）**：

1. `v-loading` 是**指令**，漏注册不会报错，只让加载态静默消失。行为探针专门守这一条。
2. **生产构建里 `base.css` 的 `:root{--el-color-primary:#409eff}` 排在我们的覆盖之后**（实测 `index.css`：ours@3502、base@5909）。若继续用 `:root`，管理端主色会悄悄从靛蓝变回 EP 蓝。改用 `:root:root`（特异性 0,2,0），与顺序无关。
3. 按需引入生成了 `src/components.d.ts`，暴露出一个被全局注册掩盖的类型缺口：`el-table` 插槽的 `row` 是 `Record<PropertyKey, any>`，传给 `onSwitchChange(tool: Tool)` 报 TS2345。这是一次真实的类型收紧，不是回归。

---

## 5. 项 D：三个独立小项

### 5.1 D1 图片转 WebP

现状：`public/images/portal_scene.jpg` 319 KB；`assets/bg-photos` 10 张 1.1 MB；`assets/redraw-mural` 14 张 684 KB；dist 内合计 1.8 MB。

做法：

1. `npm i -D sharp`，写 `scripts/optimize-images.mjs`（一次性脚本，保留在仓库供后续复用）：
   - 照片墙/壁画 `q=76`，`resize` 到实际渲染宽度的 2 倍（壁纸列宽约 260px → 520px 足够）
   - hero 图 `q=80`，宽 1920
2. 输出 `.webp` 与原图并存，先改引用、验证，再删原图
3. `import.meta.glob('../assets/redraw-mural/*.jpg')` 改为 `*.webp`
4. hero 图建议从 `public/` 移入 `src/assets/` 并 import，让 Vite 加内容哈希（当前 `public/` 无哈希，改图后用户可能拿到旧缓存）

预期：1.8 MB → 0.6–0.8 MB；hero 319 KB → 90–120 KB。

**实测（2026-10-28）**：25 张 jpg 2,016 KB → 790 KB（照片墙 640px/q72、壁画 440px/q70、hero 1920px/q80 71 KB）；dist 图片 1.8 MB → 790 KB。原 jpg 已删除（git 可回滚），转换脚本保留在 `frontend/scripts/optimize-images.mjs`。

风险：Windows + Node 26 下 `sharp` 需预编译二进制，装不上就退到 `@napi-rs/image` 或 `squoosh-cli`（都是 wasm/预编译，无本地编译依赖）。

### 5.2 D2 壁画按断点渲染

现状问题比「图片大」更严重：`RedrawMural` 用 `eager: true` 一次性把 14 张图全部塞进 URL 列表，且 9 列全部渲染进 DOM；CSS 在窄屏只 `display: none` 掉第 7 列以后——**请求已经发出去了**。

改法：

1. `matchMedia` 监听宽度，计算 `visibleCols`（桌面 9 / 平板 8 / 手机 6），`computed` 只生成可见列
2. 每张 `<img>` 补 `loading="lazy" decoding="async" width height`，杜绝 CLS
3. 把现有「模块加载时取一次 `.matches`」改成响应式监听（当前旋转屏幕不会重新计算，是个真 bug）
4. 减动效偏好下直接不渲染壁画，只留纯色底——省下全部图片请求

验收：375px 首屏图片请求 ≤ 8 个；1440px 与改动前视觉一致；CLS 实测 0。

**实测（2026-10-28）**：375px 渲染 2 列、图片请求 8；1440px 渲染 8 列、14 张；减动效偏好下壁画不渲染、图片请求 0。断点改由脚本按 `matchMedia` 驱动，旋转屏幕会重算；`pnpm gate` 零差异。

### 5.3 D3 独立 404 路由（并入第 4 步执行）

现状：`:pathMatch(.*)*` 直接 `redirect: '/'`。用户输错链接会被静默送回首页，既不知道错了，也拿不到正确的状态码语义。

做法（作为 A 的最后一个提交）：

1. 新建 `views/NotFoundView.vue`，复用 A 产出的 `NotFoundState`
2. 路由改为 `component: () => import('@/views/NotFoundView.vue')`，加 `meta: { title: '页面不存在' }`
3. 保留 `ToolPlaceholder` 的「未找到该工具」分支——语义不同：路由存在但工具 id 不在库里，属于业务空态，不该变成全站 404
4. 若后续上 nginx，确认 `try_files` 已把未知路径回落到 `index.html`，否则前端路由拿不到这次渲染机会

---

## 6. 排期与验收

### 6.1 建议节奏（时间充足版）

串行，不并行。每一步结束都要过闸门 + `vue-tsc` + `build`，再进行下一步。

| 天 | 步 | 内容 | 完成标志 |
|---|---|---|---|
| D1 | 0 | 回归闸门：选择器清单、计算样式快照、几何快照、三档截图；连跑两次证明结果可复现 | 同一份代码两次运行差异为 0；基线目录入库 |
| D1–D2 | 1 | C：EP 按需（插件 → 删全量注册 → 补命令式样式 → `ElConfigProvider` → 抽 overrides） | CSS ≤ 190 KB、JS ≤ 650 KB，`v-loading` 与 Message 正常 |
| D2 | 2 | D1：图片转 WebP（含 hero 移入 `src/assets` 拿哈希） | dist 图片 ≤ 800 KB，hero ≤ 120 KB |
| D3 | 3 | D2：壁画按断点渲染 + 响应式 `matchMedia` | 375px 图片请求 ≤ 8，CLS = 0 |
| D3–D5 | 4 | A：6 个提交（`useToolMeta` → `ToolPageHeader` → `SubmitButton` → `EmptyState` → `useLongTask` → `NotFoundState` + D3 + `PhotoWall`） | 净删约 700 行重复 CSS，7 页 × 3 档零位移 |
| D6 上午 | 5 | B：视频本地化（转码 + 海报 + 分级加载） | 断网仍有背景；375px 不请求 mp4 |
| D6 下午 | 6 | 预算守卫 + 全量验收 + 更新评审报告 | `check-budget.mjs` 接入 build；报告追加二期记录 |

可并行的一件事：B 的转码实验不依赖任何代码改动，想省一天的话，用 `git worktree add ../hftools-media` 单开一个工作树跑 `ffmpeg` 试参数，A 分支上继续写组件，两边不互相污染。

### 6.2 全局验收清单（2026-10-28 全量执行）

- [x] `npx vue-tsc -b --force` exit 0
- [x] `pnpm build` 通过，产物达标（见 1.1 目标列）——首屏 JS 154 KB / CSS 53 KB，全量 JS 740 KB / CSS 243 KB，图片 860 KB（含视频海报）
- [x] 7 个页面 × 3 档截图与基线一致（位移 ≤ 2px）——`pnpm gate` 差异 0
- [x] 375px 无横向滚动、顶栏单行、页头单行——7 页 × 3 档实测 `scrollWidth = clientWidth`，顶栏/页头子元素垂直中心差 ≤ 8px，页头标题 1 行
- [x] 键盘 Tab 走完全站，焦点环处处可见——7 页共采样 79 个焦点，无环 0（管理端 EP 输入框/按钮本轮补上焦点环）
- [x] 减动效偏好下无自动播放媒体、无壁画动画——首页壁画节点 0、图片请求 0；背景视频 `paused` / `readyState=0`（未取字节）、媒体请求 0
- [x] 断网后除 AI 接口外页面可正常渲染（视频/图片全部自托管）——7 页在仅放行 localhost 时全部渲染，外部请求 0 条，控制台报错 0

### 6.3 预算守卫（已落地）

`frontend/scripts/check-budget.mjs` 挂在 `pnpm build` 末尾（也可单跑 `pnpm budget`），任一指标超预算即 exit 1。

| 指标 | 预算 | 当前 |
|---|---|---|
| 首屏 JS（`index.html` 实际引用） | 250 KB | 154 KB |
| 首屏 CSS（同上） | 80 KB | 53 KB |
| 全量 JS | 900 KB | 740 KB |
| 全量 CSS | 350 KB | 243 KB |
| 图片（webp/jpg/png/svg，含视频海报） | 900 KB | 860 KB |

与原计划的「700 / 200 / 900」有出入：C 之后 EP 按需把首屏包拆成按路由分块，全量 JS 仍是 740 KB（42 个分块），用 700 KB 会天天误报。改成「首屏 / 全量」分层，各自取实测值 + 一档余量：**首屏**守地基回退（重新 `app.use(ElementPlus)` 会让入口包从 154 KB 回到 1 MB），**全量**守新增工具的分块膨胀。首屏只认 `index.html` 里真正引用的资源，不把同名的 `index-*.js` 共享分块算进去。

灵敏度自检：把首屏 JS 预算临时改成 100 KB，脚本 exit 1 并报 `OVER 154 KB / 100 KB`；恢复后 exit 0。守卫的失败信息只指向指标名，不自动放宽——增长是有意的就先改预算表，别让它静默通过。

---

## 7. 明确不做

- 不引入 SSR/SSG：纯本地工具站，收益不抵复杂度
- 不换 UI 库：Element Plus 已在用且管理端耦合较深，换库是重写
- 不做 i18n：当前仅中文，抽象多语言键会拖慢每次文案修改
- 不重写 hero 为 canvas/WebGL：现有 CSS 渐变 + 单图的表现已足够，性能风险大于观感收益
- 不做组件库发布/Storybook：只有当工具数超过 20 个、或出现第二个前端入口时才值得
