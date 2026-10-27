# 照片 AI 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 HFTools 中实现基于两阶段分析与 Responses API `image_generation` tool 的照片 AI 优化闭环，并完成真实上游联调。

**Architecture:** 保持现有 `chat/completions` 客户端不变，新增独立 `responses-image` adapter 负责 `/v1/responses`、SSE 和图片提取；新增照片优化 service 编排分析与重绘；前端采用已确认的布局 A，引入固定场景、阶段状态和结果对比。配置继续走现有加密模型配置，照片优化固定使用 Responses API。

**Tech Stack:** Node.js, TypeScript, Express, Vue 3, Pinia, Vue Router, Element Plus, SQLite, native `fetch`, SSE parser, existing API response and error utilities.

---

## 文件范围

创建或修改以下文件，避免改动无关模块：

- Create: `server-node/src/services/responses-image.client.ts`，Responses API 请求、SSE 和图片提取。
- Create: `server-node/src/services/responses-image.client.test.ts`，adapter 单元测试。
- Create: `server-node/src/services/photo-optimize.service.ts`，两阶段业务编排。
- Create: `server-node/src/services/photo-optimize.service.test.ts`，业务校验和编排测试。
- Modify: `server-node/src/routes/ai.ts`，注册照片优化 API。
- Modify: `server-node/src/services/model-configs.service.ts`，支持可选 `image_model` 和配置读取。
- Modify: 管理端现有模型配置 view/component，增加 Responses API 固定提示和能力测试入口。
- Modify: `frontend/src/api/ai.ts`，增加照片优化请求类型和 API 方法。
- Create or modify: `frontend/src/views/PhotoOptimizeView.vue`，布局 A 工作台。
- Modify: `frontend/src/router/index.ts`，注册照片优化路由。
- Modify: `server-node/src/db/seed.ts` 或现有工具 seed，保证照片 AI 优化从 placeholder 迁移到实现前保持正确状态。
- Modify: `README.md` 或对应阶段成果文档，在完成真实验收后记录最终状态。

## 任务 1：固定后端共享契约和场景白名单

**Files:**
- Create: `server-node/src/services/photo-optimize.service.ts`
- Modify: `server-node/src/routes/ai.ts`
- Test: `server-node/src/services/photo-optimize.service.test.ts`

- [ ] **Step 1: 写输入校验失败测试**

覆盖：缺少图片、非法 data URL、空场景、未知场景、过长描述，以及合法的 11 个场景均可通过。测试断言错误 code，不断言完整错误文案。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --runInBand server-node/src/services/photo-optimize.service.test.ts`

Expected: 当前仓库没有测试 runner 时，先确认现有测试脚本和依赖；若没有 `npm test`，使用项目已有测试方式，不新增未确认的测试框架。

- [ ] **Step 3: 实现最小契约**

在 service 中导出 `PHOTO_OPTIMIZE_SCENES`、请求类型、分析结果类型和 `validatePhotoOptimizeInput()`。场景 key 固定为：`general`、`xiaohongshu`、`moments`、`douyin`、`video-cover`、`travel`、`portrait`、`product`、`food`、`landscape`、`portfolio`。沿用照片点评的图片格式和大小校验，后端不接受前端传入配置、API key 或 tool 参数。

- [ ] **Step 4: 运行测试确认通过**

Run: 项目实际测试命令；Expected: 输入校验测试 PASS。

## 任务 2：实现 Responses API adapter

**Files:**
- Create: `server-node/src/services/responses-image.client.ts`
- Test: `server-node/src/services/responses-image.client.test.ts`

- [ ] **Step 1: 写请求构造和 SSE 失败测试**

使用 mock `fetch` 覆盖：endpoint 规范化到 `/v1/responses`、请求包含 `stream: true`、`tools` 含 `image_generation`、instructions 包含原样传递约束、可选 `image_model` 只在有值时发送；覆盖跨 chunk SSE、error event、提前结束、空图片和 `[DONE]`。

- [ ] **Step 2: 实现 adapter 类型和请求构造**

导出 `generateImageWithResponsesApi(input)`。输入包含 `baseUrl`、`apiKey`、`model`、可选 `imageModel`、原图 data URL、最终 prompt 和 timeout。使用 `AbortController`，默认超时覆盖长耗时 SSE 请求。请求 header 只在服务端构造，禁止把 key 写入错误信息。

- [ ] **Step 3: 实现跨 chunk SSE parser**

以 `ReadableStream` reader 逐块读取，使用持久 buffer 按空行切分事件，保留不完整行；解析 `event` 和 `data`；处理 `[DONE]`、上游 error event、连接中断、JSON 解析失败和本地 timeout。将错误统一映射为项目现有 `ApiError`。

- [ ] **Step 4: 实现图片提取和校验**

支持已确认的 base64/data URL 字段；若实际上游只返回 URL，则由后端下载后重新校验响应 MIME、大小、base64 和可解码性。partial image、未知 MIME、空图片和解码失败分别映射为明确错误。

- [ ] **Step 5: 运行 adapter 测试**

Run: 项目实际测试命令；Expected: 请求构造、SSE parser、图片提取和错误映射测试 PASS。

## 任务 3：实现阶段一分析和两阶段编排

**Files:**
- Modify: `server-node/src/services/photo-optimize.service.ts`
- Test: `server-node/src/services/photo-optimize.service.test.ts`

- [ ] **Step 1: 写分析 schema 和编排测试**

覆盖阶段一 JSON 合法返回、缺字段、错误 JSON、非字符串方向、非法数组；确认分析失败时不调用 Responses adapter；确认生成阶段收到场景要求、裁切方向、`preserve`、`avoid` 和照片描述；确认分析结果在生成失败时可返回给上层。

- [ ] **Step 2: 实现阶段一多模态调用**

复用现有 `getDecryptedConfig('llm')` 和 `chatCompletion`，将原图与描述、固定场景要求发送给多模态模型。system prompt 要求只输出规定 JSON，不允许把自由文本当作结构化结果。

- [ ] **Step 3: 实现 schema 校验和 prompt 组装**

解析模型文本中的 JSON；校验 `summary`、`directions`、`preserve`、`avoid`；将场景默认倾向、分析方向和保护/避免约束组合为最终 prompt，并明确裁切参与实际重绘。不得接受用户自定义平台名称改变 prompt。

- [ ] **Step 4: 实现 `optimizePhoto()`**

流程固定为：输入校验、阶段一分析、schema 校验、prompt 组装、调用 Responses adapter、图片输出校验、返回 `analysis` 和 `result_image`。生成失败不自动重试。

- [ ] **Step 5: 运行 service 测试**

Run: 项目实际测试命令；Expected: 编排和失败边界测试 PASS。

## 任务 4：注册 API 路由和配置能力测试

**Files:**
- Modify: `server-node/src/routes/ai.ts`
- Modify: `server-node/src/services/model-configs.service.ts`
- Modify: 管理端现有模型配置页面和 API 文件

- [ ] **Step 1: 写路由测试**

覆盖 `POST /api/ai/photo-optimize` 的成功和错误响应；覆盖能力测试的配置缺失、上游鉴权失败、Responses 不支持、tool 不支持、SSE 无图片。确认通用 `/:task` 路由不会抢先匹配照片优化 endpoint。

- [ ] **Step 2: 扩展配置字段**

在现有加密配置读取、写入和 mask 流程中加入可选 `image_model`，保持旧配置可读取。照片优化只读取后端解密结果，不向前端返回 key。

- [ ] **Step 3: 实现能力测试 endpoint**

新增管理端鉴权保护的测试 endpoint，使用低成本、低分辨率、明确标记为测试的 Responses 请求，验证 `/v1/responses`、图片输入、`image_generation`、SSE 和最终图片。测试不自动重试，不保存图片，不记录完整响应。

- [ ] **Step 4: 增加固定配置提醒**

管理端明确显示：用户必须自行配置支持 Responses API、图片输入、SSE 和 `image_generation` 的 API；文本模型 ID 和可选 `image_model` 不写死。`image_model` 未填写且上游要求时，返回配置不可用错误。

- [ ] **Step 5: 运行后端 build 和 API 测试**

Run: `npm run build --workspace @hftools/server-node` 以及项目实际 API 测试命令；Expected: TypeScript 编译和路由测试 PASS。

## 任务 5：实现前端布局 A 工作台

**Files:**
- Create or modify: `frontend/src/views/PhotoOptimizeView.vue`
- Modify: `frontend/src/api/ai.ts`
- Modify: `frontend/src/router/index.ts`
- Modify: 工具卡片或 placeholder 映射

- [ ] **Step 1: 写前端交互检查清单**

确认上传预览、11 个场景、描述字数、提交禁用、处理中阶段、成功结果、下载和失败重试均有可验证选择器或可见文本。

- [ ] **Step 2: 实现 API 方法和页面状态**

在 `frontend/src/api/ai.ts` 增加类型安全的 `photoOptimize()`；页面维护 image data URL、file name、scene、note、processing stage、analysis、result image 和 error 状态。提交时禁止换图和重复提交。

- [ ] **Step 3: 实现上传与场景输入区**

复用 `PhotoReviewView.vue` 的拖拽、文件选择、data URL 读取和格式/大小校验；使用固定场景配置，不渲染任意平台输入；布局按 A 的单页双栏实现，并适配窄屏堆叠。

- [ ] **Step 4: 实现阶段状态和结果区**

显示“分析原图”“整理优化方向”“生成优化图”“接收并处理结果”四阶段。成功后并列展示原图和结果图、结构化优化方向、下载按钮和 AI 重绘免责声明。错误时保留输入和原图，提供手动重试。

- [ ] **Step 5: 运行前端 build**

Run: `npm run build --workspace frontend`；Expected: Vue/TypeScript/Vite build PASS。

## 任务 6：浏览器验证和真实上游联调

**Files:**
- Modify: `README.md` 或现有阶段成果记录，仅在验收完成后更新

- [ ] **Step 1: 启动前后端开发服务**

使用项目既有启动方式启动 server-node 和 frontend；确认没有复用冲突端口。

- [ ] **Step 2: 验证无配置错误路径**

在未配置或配置不完整时访问照片优化页，确认提交不会泄露 key，并显示 `MODEL_NOT_CONFIGURED` 或对应配置提示。

- [ ] **Step 3: 配置真实上游并执行能力测试**

由管理员在管理端填写自己的 `base_url`、API key、文本模型 ID 和可选 `image_model`。能力测试必须确认完整组合 `Responses API + image_generation + image input + SSE + final image output`。测试可能产生费用，执行前需由用户自行确认供应商计费规则。

- [ ] **Step 4: 执行真实两阶段调用**

使用人物、风景、美食、建筑和包含文字的测试图片各验证一次；检查主体、人物、文字、场景倾向、输出尺寸/格式和浏览器可下载性。不要自动重试失败请求。

- [ ] **Step 5: 检查网络与日志安全**

确认浏览器 Network 中没有 API key；确认服务端日志没有完整 data URL、完整 prompt、API key 或上游鉴权 header。

- [ ] **Step 6: 最终验证命令**

Run: `npm run lint`、前后端 `typecheck`（若项目存在对应 script）、前后端 build，以及 `git diff --check`；Expected: 所有已存在且适用的检查通过。若项目没有 lint/typecheck script，记录未提供该命令，不临时伪造脚本。

- [ ] **Step 7: 更新阶段成果**

仅在真实联调、浏览器验收和安全检查全部通过后，将照片 AI 优化从 placeholder 切换为 active，并在 `AGENTS.md` 阶段成果区追加最终结果。不要提交 git commit，除非用户明确要求。
