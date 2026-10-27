# 项目规则（AGENTS.md）

***

## 一、角色定位

服务于 **HFTools** 的协作型 AI 助手：理解项目背景与既有契约，按统一规范完成需求、方案、编码与文档交付。

***

## 二、项目认知

### 2.1 概述

- 个人 vibe coding 作品（求职演示）；以「个人 AI 工具箱」概念封装常用 AI 能力。
- 仅本地单机运行，不对外开放；Dify 复用本地部署，经 API 调用。

### 2.2 功能地图

状态以 `server-node/src/db/seed.ts` 为准（启动时幂等同步 `status`/`icon`/`name`）；`placeholder` 工具走 `/tool/:id` 占位页。

| 分类 | 工具（id） | 路由 | 状态 |
| ---- | ---- | ---- | ---- |
| 摄影 | 照片点评（photo-review） | `/tools/photo-review` | ✅ 多模态点评 |
| 摄影 | 照片AI优化（photo-enhance） | `/tools/photo-enhance` | ✅ 分析 + 重绘 |
| 摄影 | 摄影器材参数 / 摄影基础知识 | — | 🚧 |
| AI 工程 | 提示词优化（prompt-engineering） | `/tools/prompt-engineering` | ✅ 单轮优化 |
| AI 工程 | AI工具下载/介绍 / git热点追踪 | — | 🚧 |
| 求职 | JD拆解 / 简历优化 / 公司背调 | — | 🚧 |

分期：**P0** 管理平台、照片点评、照片AI优化、JD拆解、git热点追踪；**P1** 简历优化、公司背调；**P2** 器材参数、基础知识、AI工具。提示词优化已提前完成。

### 2.3 技术架构

- **形态**：monorepo —— `frontend`（Vue3 + Vite + Pinia + Router + Element Plus）、`server-node`（Express + SQLite 网关）、`worker-python`（预留，未编排）；compose 起前端 8080（nginx 托管 + `/api`、`/static` 反代）与网关 3001（数据卷 `server-node/data`），开发态 5173 / 3001。
- **接口契约**：统一 `{ code, message, data }`；成功 `sendOk()`，业务错误抛 `ApiError(status, code, message)` 交全局 errorHandler；Express 4 的 async 路由须 `try/catch → next(err)`（需携带附加数据时显式回包）；带 base64 图片的接口在全局 `express.json()` 之前单独放宽 `12mb`；具体 AI 路由必须注册在通用 `/api/ai/:task` 之前。
- **路由分区**：`/api/tools`（公开，仅启用工具）、`/api/admin/*`（JWT，login 除外）、`/api/ai/*`（AI 代理）。
- **数据**：SQLite `tools` / `model_config`（单行 `id=1`：`base_url` / `api_key` 密文 / `default_model` / `image_model`（空=跟随默认 `gpt-image-2`）/ `reasoning_effort`）/ `admin_users`；旧表 `model_configs` 自 v2 起只读保留（迁移用 `PRAGMA user_version=1`）；建表与迁移幂等；首启无管理员时创建 `admin / admin123`。
- **安全**：前端零密钥，AI/外部调用全经网关；`api_key` 由 `SECRET_KEY` 派生 AES-256-GCM 加密落盘、仅回显脱敏值；日志不落 key、完整 prompt、完整图片，错误详情脱敏截断；`.env`、`*.db`、`data/` 不入库。
- **前端**：TS strict + `<script setup>`；`api/http.ts` 开发直连 3001、生产同源 `/api`，默认 15s，长任务按接口覆盖（点评/提示词 120s、照片优化 240s），401 清 token 跳登录；用户端深色电影风令牌集中在 `style.css`，管理端 Element Plus 浅色；LLM 输出一律 `marked` + `DOMPurify`（中文紧跟加粗先 `normalizeBold`）；工具图标由 `ToolIcon` 注册表渲染，新增工具须登记；动画尊重 `prefers-reduced-motion`。
- **模型配置**：单一 OpenAI 配置，3 个管理端端点（`GET/PUT /api/admin/model-config`、`POST /api/admin/model-config/models`）；不做保存前校验（无探测/试调用），配置页常驻「模型能力要求」告知；拉取结果不缓存、仅页面内存；推理强度三档（low/medium/high），仅对 `o1+`/`gpt-5*` 前缀透传；生图模型写入 `tools[0].model`（不用顶层 `image_model`），空值回退 `gpt-image-2`。
- **AI 链路**：点评 → `llm-client`（`chat/completions`）+ `assets/photo-review` prompt；提示词优化 → `base + level-* + scene-*` 片段拼接单轮调用；照片优化 → 多模态 JSON 分析 → `buildFinalPrompt` → `image-edit.client`（`/v1/images/edits` multipart 图生图，`model`=配置的生图模型），生成失败可携 `analysis` 走 `/retry` 仅重绘。`responses-image.client`（`/v1/responses` + `image_generation` 工具）保留未用：实测部分中转不支持该工具调度（生图稳定报"请求超时未返回"），但支持标准 `images/edits`。
- **资产**：`server-node/assets` 经 `/static` 暴露（Docker 需显式 COPY）；前端字体/舞台图在 `public/`，照片墙由 `import.meta.glob` + seeded 伪随机布局。

### 2.4 阶段成果

| 日期 | 模块 | 产出 | 关键指标 |
| ---- | ---- | ---- | ---- |
| 2026-09-09 | 平台框架 | monorepo + 网关 + 10 工具注册机制 + 管理平台（JWT / 工具开关 / AES 模型配置）+ compose | spec 验收 15/15；4 次提交 |
| 2026-09-09 | 照片点评 | skill prompt 入 assets + 多模态代理 + 点评页（净化渲染、等待动画、照片墙）+ 转 active | 真实点评约 30s；修复取数与 CJK 加粗；浏览器全路径通过 |
| 2026-09-12 | 提示词优化 | 7 片段模板拼接 + 单轮代理 + 前端页（示例、级别、场景、视频背景、复制/下载） | 真实调用约 20s；400 校验验证；浏览器 9/9 通过 |
| 2026-09-23 | 照片AI优化 | 分析 + Responses 重绘两阶段；SSE adapter、`/photo-optimize` 与 `/retry`、管理端 `image_model` 与能力测试、工作台页；转 active | 类型检查通过（10-27 复核）；错误码覆盖配置/不支持/鉴权/限流/超时/空图；**真实联调与浏览器验收待补** |
| 2026-10-27 | 模型配置 v2 | 三类配置合并为单行 `model_config`；上游模型拉取/复制；推理强度三档；收敛 OpenAI；删除 dify；生图模型改 `tools[0].model` | 迁移 1 次通过（`user_version=1`，默认模型 `gpt-5.6-terra`、生图 `gpt-image-2`）；真实拉取 7 个模型；前端 build + 后端 tsc 通过；**真实 AI 调用与浏览器验收待补** |

### 2.5 常用命令

```bash
pnpm install && pnpm dev      # 安装；前端 5173 + 后端 3001
pnpm dev:web / pnpm dev:api   # 单独启动
cd frontend && pnpm build     # vue-tsc -b && vite build
cd server-node && npx tsc --noEmit -p tsconfig.json
docker-compose up --build -d  # 8080 / 3001
```

> 仓库暂无自动化测试框架；改动后至少跑前端 build 与后端 `tsc --noEmit`。

***

## 三、任务执行 SOP

1. **接收**：识别类型（需求/方案/编码/文档/数据/杂项）；确认是否触及既有契约（API、DB、工具注册）；涉及已有功能**先问不臆测**，新增功能先确认目标/用户/场景/边界/风险/成功标准。
2. **执行**：严格按规范，禁止越权删改与未授权部署；最小变更，不做无关「顺手优化」；新增接口沿用统一响应与错误结构，跨端常量（场景、枚举）前后端保持同步，新增工具同步 seed 与 `ToolIcon`；关键决策留痕。
3. **交付**：自检功能完成度、对既有功能（点评/提示词/照片优化）的回归、规范符合性；阶段成果追加 2.4，交付物沉淀 `docs/`；删除临时产物。

***

## 四、协作约定

**必须先确认**：删除/覆盖/批量修改/不可逆操作；外部消息发送；隐私、敏感数据、密钥、账号；可能产生费用或明显业务后果的操作（真实付费模型调用、批量生图等）。

**可直接执行**：低风险、可逆、不影响外部的读写；有明确规范支撑的常规任务。

**假设与补充**：小细节可合理假设并显式说明；与目标强相关的必要补充可直接补齐；明显超范围先确认。

***

## 五、文档维护

| 类型 | 时机 | 方式 |
| ---- | ---- | ---- |
| `AGENTS.md` | 项目规则变更 | 直接覆盖（更新前确认） |
| 阶段成果（2.4） | 阶段交付完成 | 追加一行，保持紧凑 |
| 需求/设计/计划 | 功能启动与验收 | 沉淀 `docs/` |
| 临时文件 | 任务结束 | 立即删除 |

***

## 六、冲突处理优先级

1. 安全与隐私 → 2. 用户明确指令 → 3. 本项目规则 → 4. 通用全局规则
