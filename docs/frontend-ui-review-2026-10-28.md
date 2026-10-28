# HFTools 前端 UI 评审报告

> 评审对象：`frontend/`（Vue3 + Vite + Pinia + Element Plus）
> 评审日期：2026-10-28
> 评审视角：设计系统 / 视觉层级 / 交互状态 / 可访问性 / 响应式 / 前端性能
> 评审方式：全量源码通读（21 个 .vue + style.css，共 8167 行）+ 构建产物与静态资源测量 + 已有三张运行截图比对
> 校验基线：`npx vue-tsc -b` 通过（退出码 0），无类型错误

---

## 一、总体结论

**综合评分 6.1 / 10 —— 视觉工艺优秀，设计系统与可访问性存在系统性欠账。**

这套界面最难得的地方是**"有主张"**：纯黑舞台 + 近白墨色 + 等宽眉题 + 12 段渐隐的电影感，不是常见 AI 生成式审美（紫渐变 + 玻璃拟态 + 圆角卡片堆叠）。等待态的设计（拍立得显影、提示词节点流动、四阶段推进）甚至优于多数商业产品，且作者主动标注"阶段按时间预估推进，非后端真实进度"——这是诚实设计，值得单独肯定。

但**工程化程度跟不上视觉野心**：设计令牌停留在 8 个颜色变量，字号、间距、圆角、断点全部散落在各视图内联；5 个工具页各自复制了一份页头 / 404 / 提交按钮 / Markdown 排版；首页与用户端布局**零响应式断点**，顶栏在 400px 以下三个元素互相重叠。这些不是审美问题，是会随工具数量线性放大的结构性债务——每新增一个工具，就在第 6 份副本上再抄一遍。

| 维度 | 得分 | 判断 |
| --- | --- | --- |
| 视觉语言与品牌辨识度 | 8.5 | 单色电影感落地准确，风格统一度高 |
| 页面结构与信息层级 | 6.5 | 工具页结构清晰；首页存在权重倒挂与信息重复 |
| 交互与状态设计 | 8.0 | 等待/失败/重试态是全场最强项 |
| 设计令牌化 | 5.0 | 19 种字号、13 种圆角、30+ 硬编码色值，无间距体系 |
| 组件复用 / 设计系统 | 4.0 | 同一 UI 有 4–5 份独立实现，无 ToolPage 抽象 |
| 可访问性（WCAG AA） | 5.0 | 语义与动效降级做得好；对比度、焦点、标题层级不达标 |
| 响应式 | 4.0 | 首页/布局无断点，375px 视口顶栏重叠 |
| 前端性能 | 6.0 | 全量 Element Plus、1.1MB 主包、远端视频 |
| 管理端一致性 | 6.0 | 独立浅色主题合理，但组件与响应式缺位 |

---

## 二、值得保留的设计决策（先说好的）

评审不是只挑错。以下几点建议在后续重构中**明确保留**，不要被"统一化"抹平：

1. **诚实的进度设计**（`RedrawProgress.vue:1-3`、`PhotoOptimizeView.vue:469`）
   不渲染百分比，并在 UI 上明说"按时间预估推进"。给出假百分比会让用户拿它和真实剩余时间对账，卡在最后一段反而更焦虑——这条注释本身就体现了成熟的产品判断。
2. **动效全面尊重 `prefers-reduced-motion`**（`style.css:185-192`、`RedrawMural.vue:293-301`、`PromptOptimizeView.vue:517-521`）
   不仅关过渡，还停视频、停漂移、停轮播、停 spinner。全站覆盖，少见。
3. **失败态保留半成品**（`PhotoOptimizeView.vue:251-253`）
   分析已完成但生图失败时，`/retry` 只重发生图，并在面板上说明"保留已完成的分析"。状态机设计到位。
4. **可撤销的破坏性操作**（`ImageRedrawView.vue:65-79`）
   追加模板 / AI 优化 / 清空都留 8 秒撤销快照，成本极低但体验收益高。
5. **装饰层彻底隔离**（`RedrawMural.vue:102`、`PhotoReviewView.vue:225`）
   `pointer-events: none` + `aria-hidden` + `alt=""`，背景不污染交互树与读屏。

---

## 三、P0 —— 阻断级问题（建议本周内修复）

### P0-1 用户端顶栏在 ≤400px 视口三元素重叠

`layouts/UserLayout.vue:49-62` + `93-100`。`.topbar` 用 `justify-content: space-between`，但 `.topnav` 是 `position: absolute; left: 50%` 独立定位的，三者不参与同一套布局约束，且该文件**没有任何 `@media` 断点**。

按 375px 视口实测推算（padding 20px，品牌 26+10+62≈98px）：

| 元素 | 起止（px） | 冲突 |
| --- | --- | --- |
| `.brand` | 20 → 118 | — |
| `.topnav`（居中 148px 宽） | 106 → 254 | **与品牌重叠 12px** |
| `.pill-nav`（min-width 104） | 236 → 340 | **与导航重叠 18px** |

即"摄影 / AI 工程 / 求职"会直接压在 "HFTools" 和"管理平台"上。这不是"略微拥挤"，是可读性失效。

**建议**：≤560px 隐藏 `.topnav`（导航在首页有三个分区锚点，移动端由页面内引导替代），`.pill-nav` 收成图标按钮或缩短为"管理"；或改用 `display: grid; grid-template-columns: 1fr auto 1fr` 让三者共享同一布局上下文。

### P0-2 首页与用户端布局完全没有响应式断点

`views/HomeView.vue`、`layouts/UserLayout.vue` 全文件仅含 `prefers-reduced-motion` 查询，**零宽度断点**。而同项目工具页已有 880/720/640/560 四套断点——说明能力具备，只是首页被跳过了。

具体风险：
- `.headline` 的 `clamp(40px, 7vw, 68px)` 下限 40px，在 360px 视口内容宽 312px 下，第二行"工具链一站式调度"8 字 × 40px = 320px > 312px，会折成"工具链一站式调 / 度"。中文标题断行位置不可控，且 `span { display: block }` 无法阻止行内折行。
- `.strip` 用 `position: absolute; bottom: 34px` + `gap: clamp(28px, 5vw, 56px)`，窄屏下三项总宽可能超出并溢出裁剪。
- `.card-grid` 用 `minmax(250px, 1fr)` 尚可，但 `.category-header` 的 `align-items: baseline` 在换行后基线对齐会失效。

**建议**：最低补 640px 与 400px 两档；headline 下限降至 `clamp(30px, 8.4vw, 68px)` 并加 `word-break: keep-all` 保护中文词组。

### P0-3 照片点评页背景墙严重干扰正文可读性

对照 `screenshots/photo-review.png`：`.crumb`（"TOOLS / PHOTO-REVIEW"）与 `.tool-title`（"照片点评"）**直接压在明亮照片上**，几乎无法辨认；右侧"返回工具箱"白胶囊成为全页最亮元素。

根因在 `PhotoReviewView.vue:401-408`：`.wall-veil` 只有 `rgba(3,3,5,0.5)` 蒙层 + 边缘 vignette，**中心几乎不压暗**（`rgba(0,0,0,0)` 0%），而照片被刻意提亮（`.active` 时 `brightness(1)` 且每 3 秒切换）。

**同一个仓库里 `ImageRedrawView.vue:459-463` 已经给出正确解法**——crumb 用 `rgba(250,250,250,0.74)` + 双层 text-shadow，正文用 `.glass` 半透明模糊底衬。说明问题已知，只是没回填到点评页与照片优化页。

**建议**：把 `ImageRedrawView` 的"文字压在画面上"三件套（text-shadow 兜底 / glass 底衬 / 中心暗幕）提取为全局工具类，回填两个照片类页面。

### P0-4 四处正文对比度不达 WCAG AA（4.5:1）

| 位置 | 色值 / 背景 | 实测对比度 | 字号 | 结论 |
| --- | --- | --- | --- | --- |
| `RedrawProgress.vue:151` `.stage`（未到达阶段） | `#56565a` / glass≈`#0f0f11` | **2.61:1** | 11px | ✗ 严重 |
| `ImageRedrawView.vue:846` `.disclaimer` | `#64646a` / glass | **3.26:1** | 11.5px | ✗ |
| `UserLayout.vue:139` `.foot-sub` | `#5f5f5f` / `#050505` | **3.19:1** | 12.5px | ✗ |
| `admin/ToolsView.vue:107` `.header-tip` | `#909399` / `#fff` | **3.19:1** | 12px | ✗ |
| `ImageRedrawView.vue:667` `.prompt-input::placeholder` | `#5c5c60` / 输入框底 | **2.98:1** | 14px | ✗（placeholder 也受 1.4.3 约束） |

其中 `.disclaimer`（"重绘结果由 AI 生成…请自行确认使用合规"）与 `.prompt-input::placeholder`（"描述你想要的画面：主体、环境、构图、光线…"）承载的是**安全提示与输入指导**，不是装饰性文字，低对比度的代价最直接。

作为对照，主文本 `--muted #a7a6a6` 为 8.47:1、状态绿 `#9fdcae` 为 12.4:1、错误红 `#f56c6c` 为 6.75:1——说明色板主体是健康的，问题集中在这 5 个"随手取的灰"。

**建议**：把 `#56565a / #64646a / #5c5c60 / #5f5f5f` 统一收敛到 `--ink-quaternary: #8a8a8f`（对 `#0c0c0c` 约 5.5:1），`#909399` 换成 EP 的 `#6b6b73`。

### P0-5 上传区主动移除了键盘焦点指示

```css
/* PhotoReviewView.vue:498-503 */
.dropzone:hover, .dropzone:focus-visible {
  border-color: rgba(255,255,255,.5);
  outline: none;   /* ← WCAG 2.4.7 失败 */
}
```

`.dropzone` 是 `role="button" tabindex="0"` 的自定义按钮，是全页**第一个**也是导入流程的**唯一**入口。去掉 `outline` 后只剩一条 `rgba(255,255,255,0.22→0.5)` 的虚线边框变化，在深色照片背景上几乎不可察觉。`PhotoOptimizeView.vue:714-718` 同问题。

整体焦点态覆盖也偏低：全仓 48 个 `<button>`，仅 4 处 `:focus-visible` 规则（其中 2 处还是上面的"移除"）。`.pill`、`.mini-btn`、`.scene-chip`、`.level-option`、`.example-card`、`.submit-btn` 全部依赖浏览器默认焦点环，在各浏览器/各深色底上表现不一。

**建议**：在 `style.css` 里给 `.user-layout` 下一个统一的 `:focus-visible { outline: 2px solid #fafafa; outline-offset: 2px; border-radius: inherit }`，并删除 dropzone 的 `outline: none`。

---

## 四、P1 —— 系统性问题

### P1-1 设计令牌只做了"颜色的一半"

`style.css:19-42` 定义了 8 个颜色 + 1 个缓动，但测量结果：

- **19 种不同字号**（10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 14.5 / 15 / 15.5 / 16 / 17 / 18 / 19 / 20 / 26 / 30 / 38 …），无 type scale
- **13 种圆角**（1/2/3/4/7/8/10/11/12/14/16/99/999），`10px` 出现 14 次、`12px` 11 次、`14px` 12 次——三者视觉上无法区分，属于纯粹的熵
- **30+ 个硬编码十六进制色值**，其中 `#050505` 出现 19 次、`#ffffff` 16 次，但从未定义为 `--color-surface` / `--color-on-primary`
- **无间距令牌**：14 / 18 / 20 / 22 / 26 / 28 / 36 px 直接写在 padding/margin 里

更关键的是**语义色缺失**。`style.css:20` 的注释写"严格单色"，但实现里已经出现 6 个散落的语义色：`#9fdcae`（可用/成功）、`#f56c6c`（超限）、`#f2b8b5`（危险描边）、`#e6a23c`（部分失败）、`#e0715e`（超限计数）、`#f3b3b3`（禁止项标签）。同一个"错误"语义有 `#f56c6c` 和 `#e0715e` 两个值，"危险"有 `#f2b8b5` 和 `#f3b3b3` 两个值。

**建议**（一次性、半天工作量，收益最高）：

```css
:root {
  /* 语义色：单一来源 */
  --success: #9fdcae;
  --danger:  #f56c6c;
  --warning: #e6a23c;
  --ink-3:   #8a8a8f;   /* 替代 #56565a/#64646a/#5c5c60/#5f5f5f */
  /* 字号阶梯：全部奇数层收敛 */
  --text-xs: 11.5px; --text-sm: 12.5px; --text-base: 14px;
  --text-md: 15.5px; --text-lg: 18px;  --text-xl: 28px; --text-2xl: 38px;
  /* 圆角：只留三档 */
  --r-sm: 10px; --r-md: 14px; --r-pill: 999px;
  /* 间距：4 的倍数 */
  --s-3: 12px; --s-4: 16px; --s-5: 20px; --s-6: 24px; --s-8: 32px;
}
```

### P1-2 同一份 UI 有 4–5 份独立实现（组件化缺位）

| 样式块 | 重复文件数 | 备注 |
| --- | --- | --- |
| `.crumb` / `.tool-header` / `.tool-title` | **5** | 五个工具页各写一遍页头 |
| `.tool-icon` | **7** | 含首页、管理端 |
| `.notfound` + `.nf-code` | **4** | 同一段 404 复制四次 |
| `.submit-btn` + `.spinner` + `@keyframes spin` | **4** | 主 CTA 与旋转加载 |
| Markdown 排版（`.result-body :deep(...)`） | 2 | 点评页 / 提示词页各自维护 |
| 照片墙生成（`seededRandom` + `bgPhotos`） | 2 | **mulberry32 实现逐字符相同**，仅种子 20260911 / 20260922 不同 |

`ImageRedrawView.vue:602-640` 还有一段**完全重复的 `@media (max-width: 560px)` 块**（连着写了两次，内容一模一样），是复制粘贴的直接痕迹。

按当前节奏，新增第 6 个工具页 = 再复制约 220 行 CSS + 60 行生命周期代码。

**建议抽象 4 个组件**（可覆盖 100% 重复）：

```
components/ToolPageHeader.vue    crumb + icon + h1 + 返回 + 可选副标题
components/ResultMarkdown.vue    marked + normalizeBold + DOMPurify + :deep 排版
components/StateEmpty.vue        空态 / 404 / 未找到（icon + title + desc + action）
composables/usePhotoWall.ts      seededRandom + 布局计算 + spotlight 轮播 + 清理
composables/useLongTask.ts       startWaiting / stopWaiting / isTimeoutError / elapsed
```

顺带修好三个衍生问题：`.crumb` 的 `text-shadow` 差异、`.tool-title` 字号在重绘页被改成 46px 而其他页 38px、`.sub` 副标题只有重绘页才有。

### P1-3 视觉权重倒挂：最不重要的操作最显眼

首页唯一的白色实心胶囊是右上角**"管理平台"**——一个个人工具的管理入口。而 hero 区**没有任何 CTA**，用户看完"AI 能力集成平台 / 工具链一站式调度"后，视线自然落在最亮的那个按钮上，点进去却是登录页。

同样的问题在工具页复现：`← 返回工具箱` 也是白胶囊（`PhotoReviewView.vue:455-462`、`PromptOptimizeView.vue:560-567`、`PhotoOptimizeView.vue:668-675`），与页面 H1 争夺第一注意力。**只有 `ImageRedrawView.vue:528-549` 做对了**——它明确注释"次要动作：不用白胶囊，避免和主 CTA 抢视觉重量"，改成半透明描边按钮。

**建议**：
- 首页 hero 增加主 CTA（"浏览工具 ↓" 滚到 `#tools`），并把 `.pill-nav` 降级为 ghost 描边样式
- 三个工具页的 `.back-btn` 统一改为 `ImageRedrawView` 的描边版本

### P1-4 首页在同屏内把同一组词说了三遍，且第三次是"假链接"

- 顶栏：摄影 / AI 工程 / 求职（可点，锚点跳转）
- hero 副标题第一行：摄影 · AI 工程 · 求职
- hero 底部 strip：摄影 · AI 工程 · 求职（`HomeView.vue:72-76`）

三者在 600px 高度内重复出现，信息量为零。更麻烦的是 `.strip-item` 是 `<span>`，视觉上却完全模仿"logo 条 / tab 条"（大字号 15px + 700 字重 + 圆点分隔），用户会去点，点了没反应——**这是可点击外观与不可点击行为的直接矛盾**。

**建议**：strip 改为真正可点的分类快捷入口（`<a href="#cat-xxx">`），或改造成"已上线 4 / 规划 7"之类有信息量的统计条。二选一，不要维持现状。

### P1-5 标题层级断裂：所有工具页没有 h1

- `HomeView.vue:61` 有 `<h1 class="headline">` ✓
- 四个工具页 + 占位页：页标题全部是 `<h2>`（`PhotoReviewView.vue:252`、`PhotoOptimizeView.vue:362`、`PromptOptimizeView.vue:327`、`ImageRedrawView.vue:302`、`ToolPlaceholder.vue:36`）
- `RedrawHistoryPanel.vue` 的"历史记录"也是 `<h2>`

后果：工具页跳过 h1 直接出现 h2；且"历史记录"与页面标题同级，读屏用户按标题导航时无法区分主从。

**建议**：工具页标题统一 `<h1>`，CSS 上的 `font-size` 保持不变（视觉不受影响）；历史面板降为 `<h2>`（此时层级才正确）。

### P1-6 每个工具页强制重拉工具列表，且用全页遮罩打断首屏

五个视图的 `onMounted` 都写了：

```ts
await toolsStore.fetchTools(true);   // force = true
```

而 store 的设计意图明确是"已加载则跳过"（`stores/tools.ts:16-20`）。传 `true` 让缓存彻底失效——一次会话内首页 + 4 个工具页 = **6 次完全相同的 GET `/api/tools`**，每次还要重新挂载一个覆盖整个视口的 `v-loading` 遮罩。

对应的是首屏体验问题：`HomeView.vue:53` 的 `v-loading` 挂在 `.home` 上，`hero` 是子元素——**精心设计的电影感首屏会被一层灰色蒙版 + spinner 盖住几百毫秒**。工具页同理，背景照片墙/画廊也被一并遮住。

**建议**：
- 改为 `fetchTools()`（不强制），仅在管理端 `invalidate()` 后失效
- loading 遮罩下沉到内容区（工具卡片网格 / 面板），不要盖 hero 与背景层
- 首屏用骨架屏或直接渲染静态首屏，数据到达后只替换工具区

### P1-7 长任务没有 live region，读屏用户全程静默

`RedrawProgress.vue:42` 有 `role="status" aria-live="polite"` ✓，但 `PhotoReviewView` 与 `PromptOptimizeView` 的等待态：

- `FUN_STATUS[funStatusIndex]` 每 2.5 秒轮播的文案（`PhotoReviewView.vue:322`）**无 aria-live**
- `elapsed` 秒数每秒更新，同样无播报
- 提交按钮文案从"开始点评"变为"点评中，通常 10–60 秒"，不是 live region

结果是视障用户按下回车后，**180 秒内没有任何反馈**，不知道请求是否发出、是否还在进行。这是长任务场景下最典型的可访问性缺口。

**建议**：等待容器的 `re-title` 外层加 `role="status" aria-live="polite"`，并且**只播报阶段切换**（而非每秒秒数，否则会淹没读屏）。秒数保持 `aria-hidden="true"`。

### P1-8 同一条"500 字上限"规则有四种实现

| 页面 | maxlength | 超限反馈 | 提交按钮 |
| --- | --- | --- | --- |
| 照片点评 | `500`（硬截断） | 无（截断即无超限） | 仅校验有图 |
| 照片优化 | 无 | 红框 + 红计数 | 禁用 |
| 提示词优化 | 无 | 红计数 | 禁用 |
| 影像重绘 | 无（10000） | 红计数 + 按钮旁提示文案 | 禁用 |

用户在四个工具间迁移时，对"超字数会发生什么"无法形成稳定预期：一处静默截断（最危险——用户以为写进去了），三处红字警告。

**建议**：统一为"允许输入 + 超限红字 + 禁用提交 + 按钮旁给出剩余字数"，并抽成 `useTextLimit()`。

### P1-9 emoji 图标破坏单色系统

`📷`（点评/优化 dropzone）、`🎞️`（点评空态）、`🪄`（优化空态）、`✒️`（提示词空态）。

在 Windows 上这些渲染为 **Segoe UI Emoji 彩色字形**——截图里 `🎞️` 是一块蓝紫色胶片，`📷` 是银灰相机，与"纯黑舞台 + 严格单色"的视觉主张直接冲突；同一套界面还并存 Element Plus 线性图标（`ToolIcon.vue`），两套图标语言混用。macOS 上是另一套配色，跨平台不一致。

**建议**：空态改用与 `ToolIcon` 同族的线性图标（EP 的 `Picture` / `MagicStick` / `EditPen` 已在注册表里），尺寸放到 32–40px + `color: var(--strip)`。

### P1-10 背景视频依赖境外 CDN，与"本地部署"定位冲突

`PromptOptimizeView.vue:316`：

```
https://d8j0ntlcm91z4.cloudfront.net/user_.../hf_20260809_...mp4
```

- 离线 / 内网 / 该域名不可达时整块背景失效（虽有 `@error` 兜底隐藏，但首屏只剩纯黑）
- 无 `poster`，加载完成前是一片黑
- `autoplay` 会在进入页面时立刻拉取整段 mp4，无体积控制
- AGENTS.md 明确本项目"仅本地单机运行，不对外开放"，外链素材是隐性外部依赖

**建议**：下载到 `public/` 下并压缩到 1–3MB（或直接换成静帧 + 轻微 ken-burns），加 `poster`；保留 `<source>` 之外给一个 `background-image` 兜底。

### P1-11 断点体系与视口单位不统一

- 断点四套：`880 / 720 / 640 / 560`，无变量，无设计依据说明
- 视口单位混用：`min-height: calc(100vh - 64px)`（点评/优化/重绘/占位）vs `calc(100dvh - 64px)`（提示词优化）vs `height: 100vh`（登录/管理端）
- 移动端浏览器地址栏伸缩时，`100vh` 会导致底部被裁 + 滚动条跳动；`100dvh` 才是正确解法

**建议**：全部统一 `dvh`（保留 `vh` 作为 fallback），断点收敛到 `1024 / 768 / 560` 三档并定义为 CSS 变量注释表。

---

## 五、P2 —— 优化项

| # | 问题 | 位置 | 影响 |
| --- | --- | --- | --- |
| P2-1 | **全量引入 Element Plus**：`import ElementPlus from 'element-plus'` + `element-plus/dist/index.css` | `main.ts:3,5` | 主包 **1.1MB JS + 356KB CSS**，实际只用十余个组件。按需引入（`unplugin-vue-components`）预计可减 60–70% |
| P2-2 | Hero 背景图 `portal_scene.jpg` 319KB，为 LCP 元素，无 `preload` / `srcset` / WebP | `HomeView.vue:138` | 首屏最大内容绘制被单张图拖慢；建议转 AVIF/WebP + `<link rel="preload">` |
| P2-3 | `RedrawMural` 渲染 **8 列 × 4 图 × 2 份 = 64 个 `<img>`**，窄屏用 `display: none` 隐藏但**仍会下载** | `RedrawMural.vue:10-11,274-290` | 移动端白付 8 列图片流量；建议按断点用 `matchMedia` 计算实际列数，或 `loading="lazy"` |
| P2-4 | 登录卡片 `width: 380px` 固定，375px 视口横向溢出 | `LoginView.vue:107-113` | 建议 `width: min(380px, calc(100vw - 32px))` |
| P2-5 | 管理端 `el-aside width="220px"` 无折叠，无任何断点 | `AdminLayout.vue:20` | ≤768px 不可用（管理端仅桌面使用，可降级） |
| P2-6 | `Tool.status` 类型为 `string`，管理端 `statusLabel()` 对非 placeholder 直接回显原值 | `types/index.ts:19`、`ToolsView.vue:32-34` | 表格里可能出现英文 `ready`；应收窄为联合类型 `'ready' \| 'placeholder'` |
| P2-7 | 深色页面未定义滚动条样式 | `style.css` | Windows 下出现系统浅灰滚动条，破坏整体暗场；`scrollbar-color` 一行可解 |
| P2-8 | `html { scroll-behavior: smooth }` 未在 `prefers-reduced-motion: reduce` 下关闭 | `style.css:48-50` | 与全站动效降级策略不一致 |
| P2-9 | 无独立 404 路由，`/:pathMatch(.*)*` 直接 `redirect: '/'` | `router/index.ts:71` | 错误链接静默回首页，用户无法判断是"没有这个页面"还是"被重定向了" |
| P2-10 | 工具页 404 无 `<title>` 变化，全站单一 title | `index.html:6` | 多标签页场景无法区分；`router.afterEach` 按 `meta.title` 更新即可 |
| P2-11 | 场景/级别选择器用 `role="radio"` 但未实现方向键漫游 | `PhotoOptimizeView.vue:404-418`、`PromptOptimizeView.vue:337-374` | WAI-ARIA radiogroup 模式要求 ←/→ 切换；当前只能 Tab 逐个走 |

---

## 六、改进路线图

### 第一阶段：止血（1–2 天，只改 UI，不动架构）

1. 补 `UserLayout` / `HomeView` 的 640px、400px 断点（P0-1、P0-2）
2. 五处低对比度文字收敛到 `--ink-3`（P0-4）
3. 恢复 `.dropzone` 焦点环 + 全局 `:focus-visible` 统一（P0-5）
4. 照片点评/照片优化页回填 glass 底衬 + text-shadow（P0-3）
5. 工具页标题 `h2 → h1`（P1-5）

> 验收：375px / 768px / 1440px 三档手动走查首页 + 四个工具页 + 登录页；键盘 Tab 全程可见焦点；用 Lighthouse Accessibility 跑一遍（目标 ≥90）。

### 第二阶段：系统化（3–5 天，收益最大）

1. 建 `styles/tokens.css`：颜色（含语义色）、字号阶梯、圆角三档、间距 4 倍数（P1-1）
2. 抽 4 个组件 + 2 个 composable（P1-2），删除 5 份重复页头 / 4 份 404 / 2 份照片墙
3. 收敛视觉权重：hero 加 CTA、`.pill-nav` 与 `.back-btn` 降级为描边（P1-3）
4. 统一字数上限交互、统一 `dvh`、统一断点（P1-8、P1-11）
5. 修 `fetchTools(true)` 与 loading 遮罩层级（P1-6）

> 验收：任意新增一个工具页，页头/空态/404/Markdown 排版均为 0 行 CSS。

### 第三阶段：体验精修（按需）

1. Element Plus 按需引入 + hero 图优化 + mural 按断点渲染（P2-1~3）
2. emoji 换线性图标（P1-9）、背景视频本地化（P1-10）
3. 长任务 live region（P1-7）、radiogroup 方向键（P2-11）
4. 管理端响应式与 404 路由（P2-5、P2-9）

---

## 七、一句话总结

**这套界面的"手感"已经达到可展示的水平，缺的是"可扩展"。** 把 8 个颜色令牌扩成一套完整令牌表、把 5 份复制粘贴收成 4 个组件、把首页补上两个断点——三件事做完，评分可从 6.1 提到 8.0 以上，且后续每个新工具的开发成本会从"再抄 280 行"降到"写 40 行业务逻辑"。

---

*评审人：UI Designer ｜ 评审基线：`frontend/` @ 2026-10-28 ｜ 类型检查：通过*

---

## 八、修复记录（2026-10-28 执行）

### 已完成

| 编号 | 问题 | 落地方式 | 涉及文件 |
| --- | --- | --- | --- |
| P0-1 | 顶栏 ≤400px 三元素重叠 | 顶栏改 `display: grid; grid-template-columns: 1fr auto 1fr`，`.topnav` 去掉绝对定位；≤560px 收起中部导航，≤400px 收小品牌与管理按钮 | `layouts/UserLayout.vue` |
| P0-2 | 首页零响应式断点 | 补 640px / 400px 两档；headline 下限 40→30px 且 `word-break: keep-all`；`.strip` 窄屏改常规流 | `views/HomeView.vue` |
| P0-3 | 照片页正文被背景墙压住 | `.wall-veil` 中心由 `rgba(0,0,0,0)` 改为 `rgba(3,3,5,.88)`；crumb 提到 `rgba(250,250,250,.74)` + 双层 text-shadow；标题补 text-shadow | `PhotoReviewView.vue`、`PhotoOptimizeView.vue` |
| P0-4 | 五处对比度不达 AA | 新增 `--ink-3: #8a8a8f`，替换 `#56565a` / `#64646a` / `#5c5c60` / `#5f5f5f`；管理端 `#909399` → `#6b6b73` | `style.css`、`RedrawProgress.vue`、`ImageRedrawView.vue`、`RedrawHistoryPanel.vue`、`TemplatePickerDialog.vue`、`UserLayout.vue`、`admin/ToolsView.vue`、`admin/ModelsView.vue` |
| P0-5 | 上传区吞掉键盘焦点 | 删除两处 `outline: none`；`style.css` 增加 `.user-layout :focus-visible` 统一焦点环；`.note-input` / `.draft-input` / `.prompt-input` 只改边框不再清除 outline | `style.css` + 4 个工具页 |
| P1-1 | 令牌只做了颜色一半 | 新增语义色 `--success/--danger/--danger-soft/--warning`、圆角三档 `--r-sm/md/pill`、字号阶梯、间距 `--s-3..8`，并附断点约定表；13 处散落语义色收敛为变量 | `style.css` + 6 个组件/视图 |
| P1-3 | 视觉权重倒挂 | 首页 hero 新增唯一白色主 CTA「浏览工具」；`.pill-nav` 与 `.back-btn` 降级为全局描边幽灵按钮 | `style.css`、`HomeView.vue` |
| P1-4 | 分类条是"假链接" | `.strip-item` 由 `<span>` 改为 `<a href="#cat-*">` 真锚点，`.strip` 换 `<nav aria-label>` | `HomeView.vue` |
| P1-5 | 工具页无 h1 | 5 个工具页标题 `h2 → h1`（CSS 类不变，视觉零影响）；历史面板保持 h2，层级恢复正确 | 5 个 `views/*.vue` |
| P1-6 | 每页 `fetchTools(true)` + 遮罩盖首屏 | 6 处改为 `fetchTools()` 复用缓存；首页 loading 从 `.home` 下沉到 `#tools` | 6 个视图 |
| P1-7 | 长任务无 live region | 点评/提示词/照片优化三处等待容器加 `role="status" aria-live="polite"`，秒数 `aria-hidden` | 3 个工具页 |
| P1-8 | 字数上限四种实现 | 点评页去掉 `maxlength` 硬截断，改为超限红框 + 红计数 + 禁用提交，与其余三页一致 | `PhotoReviewView.vue` |
| P1-9 | emoji 破坏单色系统 | `📷/🎞️/🪄/✒️` 全部换 EP 线性图标（`Camera/Picture/MagicStick/EditPen`），`color: var(--strip)` | 3 个工具页 |
| P1-11 | 视口单位不统一 | 各页 `min-height` 补 `100dvh` 回退（保留 `vh` 兜底） | `style.css`、`UserLayout.vue`、4 个工具页 |
| P1-2 | 重复的 560px 媒体查询 | 删除 `ImageRedrawView` 中逐字符重复的第二份 `@media (max-width: 560px)` | `ImageRedrawView.vue` |
| P2-4 | 登录卡固定 380px | 改 `width: min(380px, calc(100vw - 32px))` | `admin/LoginView.vue` |
| P2-6 | `status` 类型过宽 | 收敛为 `ToolStatus = 'active' \| 'placeholder'`；`statusLabel()` 修正（原 `active` 会直接回显英文） | `types/index.ts`、`admin/ToolsView.vue` |
| P2-7 | 深色页出现浅灰滚动条 | `html:has(.user-layout)` 设 `scrollbar-color` + `color-scheme: dark`（管理端不受影响） | `style.css` |
| P2-8 | smooth scroll 未降级 | `prefers-reduced-motion: reduce` 下 `scroll-behavior: auto` | `style.css` |
| 补充 | 窄屏工具页页头折成两行 | 四页补 ≤560px 页头规则：图标收小、标题 `ellipsis`、返回按钮 `nowrap` | 4 个工具页 |

### 验证

- `npx vue-tsc -b --force`：通过（exit 0）
- `pnpm build`：通过（12.5s）
- 真实浏览器走查：1440px 首页；375px 首页 / 照片点评 / 照片优化 / 影像重绘；768px 照片点评
  - 顶栏在 375px 下品牌、导航、管理入口三者不再重叠（<560px 导航隐藏）
  - 「工具链一站式调度」在 375px 下整行不折字
  - 工具页页头在 375px 下单行排布（图标 + 标题 + 描边返回按钮）
  - 照片墙蒙层加深后 `TOOLS / PHOTO-REVIEW` 与页面标题清晰可辨
  - 首页主 CTA 成为页面唯一白色实心胶囊，管理入口降为描边

### 未执行（需单独排期）

| 编号 | 项 | 原因 |
| --- | --- | --- |
| P1-2 | 抽 4 组件 + 2 composable，删除 5 份重复页头 / 4 份 404 / 2 份照片墙 | 属结构性重构，需单独分支 + 逐页视觉回归；本轮只做了零风险的重复块删除 |
| P1-10 | 背景视频本地化 | 源文件 13.8MB，本机无 ffmpeg 无法压到 1–3MB；需先解决转码工具链，或改用静帧 + ken-burns |
| P2-1 | Element Plus 按需引入 | 需引入 `unplugin-vue-components` 并全站回归，主包 1.07MB 的收益与风险比不适合混在本轮 |
| P2-2 | hero 图 AVIF/WebP + preload | 依赖图片处理管线 |
| P2-3 | `RedrawMural` 按断点渲染 | 需改组件内部列数计算逻辑，属中等改动 |
| P2-5 | 管理端 ≤768px | 管理端仅在桌面使用，按报告判定可降级 |
| P2-9 / P2-10 | 独立 404 路由、按路由更新 title | 属行为变更，需确认产品预期 |
