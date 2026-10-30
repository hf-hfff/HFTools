# 项目规则（AGENTS.md）

## 一、定位

服务 HFTools 的协作型 AI 助手：理解项目背景与既有契约，按统一规范完成需求、方案、编码与文档交付。

## 二、项目认知

### 2.1 概述

个人 vibe coding 作品（求职演示），以「个人 AI 工具箱」封装常用 AI 能力；仅本地单机运行，不对外开放。

### 2.2 功能与分期

状态以 `server-node/src/db/seed.ts` 为准（启动时幂等同步 `status`/`icon`/`name`）；未完成工具走 `/tool/:id` 占位页。

- **已上线**：照片点评 `/tools/photo-review`、照片AI优化 `/tools/photo-enhance`、影像AI重绘 `/tools/image-redraw`、提示词优化 `/tools/prompt-engineering`
- **待建**：摄影器材参数、摄影基础知识、AI 工具下载/介绍、git 热点追踪、JD 拆解、简历优化、公司背调
- **分期**：P0 管理平台 + 照片点评 + 照片AI优化 + JD 拆解 + git 热点追踪；P1 简历优化 + 公司背调；P2 其余

### 2.3 架构与硬约束

- **形态**：monorepo —— `frontend`（Vue3 + Vite + Pinia + Element Plus）/ `server-node`（Express + SQLite 网关）/ `worker-python`（预留）。compose 起前端 8080（nginx 托管 + `/api`、`/static` 反代）与网关 3001（卷 `server-node/data`）；开发态 5173 / 3001。
- **接口契约**：统一 `{ code, message, data }`；成功 `sendOk()`，业务错误抛 `ApiError(status, code, message)` 交全局 errorHandler；async 路由必须 `try/catch → next(err)`；含 base64 图片的 AI 接口在全局 `express.json()` 之前单独放宽 `30mb`（模板示例图仍 `12mb`），单张原图上限统一 **20MB**；具体 AI 路由必须注册在通用 `/api/ai/:task` 之前。
- **路由分区**：`/api/tools`（公开，仅启用工具）、`/api/admin/*`（JWT，login 除外）、`/api/ai/*`、`/api/redraw/*`（公开）。
- **数据**：SQLite `tools` / `model_config`（单行 `id=1`）/ `admin_users` / `redraw_templates`+`redraw_template_previews`+`redraw_history`（只存图片相对路径）；建表与迁移幂等（`PRAGMA user_version`）；首启无管理员时建 `admin / admin123`；旧表 `model_configs` 只读保留。
- **文件存储**：重绘图落 `server-node/data/redraw/`，经 `/api/redraw/files/:kind/:name` 只读提供（kind + 文件名白名单 + `resolveDataPath` 前缀校验防穿越）；历史按 100 条 / 2GB 双上限清理。
- **安全**：前端零密钥，外部调用全经网关；`api_key` 由 `SECRET_KEY` 派生 AES-256-GCM 加密、仅回显脱敏值；日志不落 key、完整 prompt、完整图片；`.env`、`*.db`、`data/` 不入库。
- **前端**：TS strict + `<script setup>`；`api/http.ts` 开发直连 3001、生产同源 `/api`，默认 15s，长任务按接口覆盖（180s / 320s），401 清 token 跳登录；用户端深色令牌集中 `style.css`，管理端 Element Plus 浅色；LLM 输出一律 `marked` + `DOMPurify`；新增工具须在 seed 与 `ToolIcon` 双登记。
- **模型配置**：单一 OpenAI 配置，`GET/PUT /api/admin/model-config`、`POST .../models`；不做保存前探测；推理强度 low/medium/high 仅对 `o1+`/`gpt-5*` 透传；生图模型写 `tools[0].model`，空值回退 `gpt-image-2`。
- **AI 链路**：点评 → `llm-client` + `assets/photo-review`；提示词优化 → 片段拼接单轮；照片优化 → 多模态分析 → `image-edit.client`（`/v1/images/edits` 图生图），失败可携 `analysis` 走 `/retry`；重绘 → `redraw.service`。`responses-image.client` 保留未用（中转多不支持 `image_generation` 调度）。
- **资产**：`server-node/assets` 经 `/static` 暴露（Docker 需显式 COPY）；照片墙用 `import.meta.glob` + seeded 伪随机布局；`src/assets/redraw-mural/` 素材勿替换。

### 2.4 阶段成果

| 日期 | 模块 | 产出 |
| ---- | ---- | ---- |
| 2026-09-09 | 平台框架 | monorepo + 网关 + 工具注册 + 管理平台（JWT / 工具开关 / AES 模型配置）+ compose |
| 2026-09-09 | 照片点评 | prompt 入 assets + 多模态代理 + 点评页（净化渲染、等待动画、照片墙） |
| 2026-09-12 | 提示词优化 | 7 片段模板拼接 + 单轮代理 + 前端页 |
| 2026-09-23 | 照片AI优化 | 分析 + 图生图两阶段、`/retry`、生图模型配置 |
| 2026-10-27 | 模型配置 v2 | 合并为单行 `model_config`、上游模型拉取、推理强度、收敛 OpenAI |
| 2026-10-27 | 影像AI重绘 | 第 11 个工具：模板 CRUD + 提示词优化 + 历史与容量清理 + 背景画廊页 |
| 2026-10-28 | 前端 UI 修复 | 评审报告 P0 全清 + P1 主体：顶栏改 grid 并补 560/400 断点、首页补 640/400 断点与主 CTA、照片页暗幕与 text-shadow、`--ink-3` 收敛低对比灰、全局 focus-visible、语义色/圆角/间距令牌、工具页 h1、fetchTools 缓存、live region、emoji 换线性图标 |
| 2026-10-28 | 前端二期 D1/D2 | 图片转 WebP（dist 图片 1.8MB → 790KB，hero 319→71KB）+ 壁画按断点渲染（375px 2 列/8 请求，减动效 0 请求）；`pnpm gate` 零差异 |
| 2026-10-28 | 前端二期 A + D3 | 组件抽象落地：`ToolPageHeader`（plain/wall/glass 三变体）/ `SubmitButton` / `EmptyState` / `NotFoundState` / `PhotoWall`（seed 参数化）+ `useToolMeta` / `useLongTask`，5 个视图净删约 1100 行重复 CSS；新增独立 404 路由（保留用户端布局）；闸门空态选择器 `.re-title/.we-title` → `.empty-title`（新旧值逐项一致）；`gate` 零差异 + `gate:behavior` 6/6 |
| 2026-10-28 | 前端二期 B | 背景视频本地化：13.86MB 境外 CDN 片源自托管到 `public/videos`（720p 262KB / 540p 89KB / 海报 70KB），`preload=none` + `poster` + JS 仅在 ≥900px 且非减动效时播放；`scripts/media-video.mjs` 可复现转码；闸门零差异、7 页无控制台错误 |
| 2026-10-28 | 前端二期收尾 | `scripts/check-budget.mjs` 接入 build（首屏 JS 250KB / CSS 80KB、全量 JS 900KB / CSS 350KB、图片 900KB，超预算即失败）；全量验收 31 项通过（7 页×3 档无横向溢出/页头单行、79 个焦点环无缺失、减动效 0 媒体请求、断网 0 外部请求）；补管理端 EP 输入框/按钮焦点环；`gate` 零差异 |
| 2026-10-28 | 首页 CTA 与照片墙调亮 | 按用户要求删除首页「浏览工具」CTA（`hero-inner` 高度 −80，文案整体下移 40）；照片墙提亮：照片 `brightness 0.45→0.62`、蒙层中心 `0.88→0.76`／全局 `0.5→0.32`；选中态提到蒙层之上（`z-index 40→60`，配 `brightness 1.08` + 更强白光晕），轮播切换明显；闸门基线重建后零差异 |
| 2026-10-28 | 上传上限统一 20MB | 照片点评 / 照片AI优化 / 影像AI重绘三处前端 `MAX_SIZE_MB` 与文案、`ImageUploader` 默认值统一为 20MB；后端三路 `IMAGE_MAX_BYTES` 同步、照片点评补 `IMAGE_TOO_LARGE` 校验，`express.json` 从 `12mb` 放宽到 `30mb`（20MB → base64 约 27MB）；实测三条路由 27MB body 均返回 400 `IMAGE_TOO_LARGE`；`tsc --noEmit` 与 `pnpm build`、`gate` 通过 |
| 2026-10-28 | 重绘下载入口迁移 | 影像AI重绘的「下载图片」从底部操作区移到重绘结果图右上角，改用与照片AI优化同款 `.download-btn`（34×34 图标 + 模糊底 + hover 反白 + `focus-visible` 环 + 减动效关过渡）；底部仅保留「重新生成」；桩响应实测距图边 10/10px |

### 2.5 常用命令

```bash
pnpm install && pnpm dev      # 安装；前端 5173 + 后端 3001
pnpm dev:web / pnpm dev:api   # 单独启动
cd frontend && pnpm build     # vue-tsc -b && vite build && 体积守卫（超预算即失败）
cd frontend && pnpm budget    # 单跑体积守卫（读 dist，不重新构建）
cd frontend && pnpm media:video  # 背景视频转码（先放 assets-src/prompt-bg.mp4，产物入 public/videos）
cd server-node && npx tsc --noEmit -p tsconfig.json
docker-compose up --build -d  # 8080 / 3001
```

> 仓库暂无自动化测试；改动后至少跑前端 build 与后端 `tsc --noEmit`。

## 三、任务执行 SOP

1. **接收**：识别类型（需求/方案/编码/文档/数据）；确认是否触及既有契约（API、DB、工具注册）；已有功能先问不臆测，新功能先确认目标/边界/成功标准。
2. **执行**：最小变更，不做无关「顺手优化」；不越权删改、不未授权部署；新增接口沿用统一响应与错误结构，跨端常量前后端同步，新增工具同步 seed 与 `ToolIcon`。
3. **交付**：自检完成度、既有功能（点评/提示词/照片优化/重绘）回归、规范符合性；阶段成果追加 2.4，交付物沉淀 `docs/`；删除临时产物。

## 四、协作约定

- **必须先确认**：删除/覆盖/批量修改/不可逆操作；外部消息发送；隐私、密钥、账号；可能产生费用或明显业务后果的操作（真实付费模型调用、批量生图）。
- **可直接执行**：低风险、可逆、不影响外部的读写；有规范支撑的常规任务。
- **假设**：小细节可合理假设并显式说明；明显超范围先确认。

## 五、文档维护

| 类型 | 时机 | 方式 |
| ---- | ---- | ---- |
| `AGENTS.md` | 项目规则变更 | 直接覆盖（更新前确认） |
| 阶段成果（2.4） | 阶段交付完成 | 追加一行，保持紧凑 |
| 需求/设计/计划 | 功能启动与验收 | 沉淀 `docs/` |
| 临时文件 | 任务结束 | 立即删除 |

## 六、冲突优先级

安全与隐私 → 用户明确指令 → 本项目规则 → 通用全局规则
