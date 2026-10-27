# 照片 AI 优化开发设计

## 1. 目标

在 HFTools 中实现“照片 AI 优化”独立工具：用户上传单张照片，选择固定优化场景并填写可选描述；后端先使用多模态模型分析原图，再使用同一配置下的 Responses API 和 `image_generation` tool 完成原图重绘，最后返回可下载的优化结果。

本功能只支持 Responses API 模式。文本模型 ID、可选的 `image_model`、`base_url` 和 API key 均由管理员配置。用户配置的 API 必须支持 `/v1/responses`、图片输入、SSE 和 `image_generation`；管理端必须展示该前提并提供真实能力测试。

## 2. 范围

首期包含：

- 单张 `jpeg/png/webp` 图片上传和预览。
- 固定场景：通用优化、小红书、朋友圈、抖音、视频封面或配图、旅行记录、人物肖像、商品展示、餐饮美食、风景摄影、作品集。
- 可选照片描述。
- 阶段一多模态分析，输出结构化优化方向。
- 阶段二 Responses API `image_generation` tool 原图重绘。
- SSE 事件解析、最终图片提取、图片可解码校验。
- 原图与优化结果对比、优化方向展示和结果下载。
- 配置能力测试。
- 分析失败、生成失败、鉴权失败、限流、超时、协议不支持和空图片的明确错误提示。

首期不包含：

- 独立 Images API。
- mask、局部重绘、多图参考、批处理、多结果生成、历史记录和手工参数面板。
- 自动重试完整生图请求。用户可以在前端手动再次重试。
- 将 Image-Studio 作为运行时依赖，或直接复制其 Go/Wails/React 源码。

## 3. 技术方案

新增独立 `responses-image` adapter，保持现有 `llm-client.service.ts` 的 `chat/completions` 契约不变。

后端职责分层：

- `photo-optimize.service.ts`：业务编排、输入校验、阶段一分析、结构化结果校验、最终 prompt 组装和阶段二调用。
- `responses-image.client.ts`：Responses API endpoint 构造、请求体构造、SSE 读取、事件解析、图片提取、上游错误归类和超时取消。
- `ai.ts`：注册照片优化 endpoint 和配置能力测试 endpoint。
- `model-configs.service.ts` 及管理端配置页面：复用加密配置和模型配置界面，补充可选 `image_model` 与 Responses API 提示。

前端使用布局 A“引导工作台”：输入区域采用单页双栏，提交后以四个稳定阶段反馈进度，成功后显示原图和结果图。

## 4. 数据流

```text
前端上传单图、选择场景、填写描述
        |
        v
POST /api/ai/photo-optimize
        |
        v
后端校验 MIME、data URL、base64、大小和场景白名单
        |
        v
chat/completions 多模态分析原图
        |
        v
解析并校验 PhotoAnalysis JSON
        |
        v
组合场景要求、分析方向、preserve、avoid 和裁切要求
        |
        v
POST /v1/responses，stream=true，tools=image_generation
        |
        v
逐事件解析 SSE，提取最终图片
        |
        v
校验图片 MIME、base64 和可解码性
        |
        v
返回 analysis、result_image 和必要的阶段结果
```

分析阶段失败时不得进入生图阶段。生图阶段失败时前端持有 `analysis`，重试经 `POST /api/ai/photo-optimize/retry` 仅重发生图（后端重新校验 `analysis`，不重复分析）；分析未完成时重试为完整重新提交。

## 5. API 契约

### 5.1 照片优化请求

`POST /api/ai/photo-optimize`

```json
{
  "image": "data:image/jpeg;base64,...",
  "scene": "xiaohongshu",
  "note": "保留人物和招牌文字，画面更适合竖版封面"
}
```

`scene` 只能是后端白名单值：

```text
general
xiaohongshu
moments
douyin
video-cover
travel
portrait
product
food
landscape
portfolio
```

### 5.2 照片优化响应

成功时：

```json
{
  "data": {
    "analysis": {
      "summary": "照片现状摘要",
      "directions": {
        "crop": "裁切与构图建议",
        "tone": "色调与色彩建议",
        "brightness": "亮度、对比度、曝光建议",
        "content": "主体、背景和细节处理建议",
        "style": "整体风格建议",
        "platform": "场景呈现建议"
      },
      "preserve": ["人物身份", "招牌文字"],
      "avoid": ["改变文字内容", "过度磨皮"]
    },
    "result_image": "data:image/png;base64,..."
  }
}
```

结果图必须是后端确认可解码的图片 data URL，不直接向前端暴露不稳定或可能需要鉴权的上游 URL。

### 5.3 配置能力测试

能力测试使用当前 `image-gen` 配置，验证：

1. `base_url` 可访问并能访问 `/v1/responses`。
2. API key 可用。
3. 配置的文本模型支持图片输入。
4. 配置的文本模型可调用 `image_generation` tool。
5. 上游返回可解析的 SSE。
6. 最终事件中存在可解码的图片。

测试请求必须是低成本、低分辨率、明确标记为测试的请求。测试结果只返回脱敏状态和错误类别，不保存测试图片、API key 或完整响应。

### 5.4 仅重发生图重试

`POST /api/ai/photo-optimize/retry`

body 为完整优化请求字段外加阶段一结果，`analysis` 结构同 5.2：

```json
{
  "image": "data:image/jpeg;base64,...",
  "scene": "xiaohongshu",
  "note": "保留人物和招牌文字",
  "analysis": {
    "summary": "照片现状摘要",
    "directions": {
      "crop": "裁切与构图建议",
      "tone": "色调与色彩建议",
      "brightness": "亮度、对比度、曝光建议",
      "content": "主体、背景和细节处理建议",
      "style": "整体风格建议",
      "platform": "场景呈现建议"
    },
    "preserve": ["人物身份", "招牌文字"],
    "avoid": ["改变文字内容", "过度磨皮"]
  }
}
```

成功响应与 5.2 相同：`{ "data": { "analysis": ..., "result_image": ... } }`。后端重新校验 `analysis`（不信任前端），不执行阶段一分析、不自动重试。

错误：输入校验与配置错误同主流程（`INVALID_IMAGE`、`MODEL_NOT_CONFIGURED` 等）；`analysis` 不合法返回 `ANALYSIS_INVALID_OUTPUT`；生图阶段失败返回原错误码，并在 `data.analysis` 中回带校验后的分析结果（与主流程错误处理一致）。

## 6. 阶段一分析契约

阶段一使用现有 `chat/completions` 多模态能力，要求模型只输出 JSON：

```json
{
  "summary": "照片现状摘要",
  "directions": {
    "crop": "裁切与构图建议，可为空",
    "tone": "色调与色彩建议，可为空",
    "brightness": "亮度、对比度、曝光建议，可为空",
    "content": "主体、背景、干扰物、细节处理建议，可为空",
    "style": "整体风格建议，可为空",
    "platform": "面向所选场景的呈现建议，可为空"
  },
  "preserve": ["必须保留的主体、关键物体或文字"],
  "avoid": ["不得发生的改变或伪造内容"]
}
```

后端必须校验 JSON 可解析、必需对象存在、方向字段为字符串或空值、`preserve` 和 `avoid` 为字符串数组。校验失败返回 `ANALYSIS_INVALID_OUTPUT`，不将原始自由文本送入生图阶段。

## 7. Responses API adapter

adapter 接收以下抽象参数：

```ts
{
  baseUrl: string;
  apiKey: string;
  model: string;
  imageModel?: string;
  image: string;
  prompt: string;
  timeoutMs?: number;
}
```

请求体使用上游实际支持的字段构造，核心语义固定为：

- endpoint：`/v1/responses`。
- `model`：用户配置的文本模型 ID。
- `input`：单条 user message，`content` 内含 `input_image`（原图 data URL）与 `input_text`（最终 prompt）两个分片。联调确认：`input_image` 不能作为 `input` 顶层 item 平铺（上游 `ItemParam` 枚举校验会以 `invalid_enum_value` 拒绝），必须嵌套在 message 的 content 内。
- `instructions`：要求将最终 prompt 原样传递给 `image_generation`，不得重写、扩写或润色。
- `tools`：包含 `image_generation`。
- `stream`：`true`。
- `image_model`：仅在用户配置且实际上游契约确认需要时发送。

字段名、输入内容结构和最终图片事件字段以实际用户上游为准，必须通过能力测试和真实联调确认，不将某个中转站私有字段当作通用协议。

SSE parser 必须支持：

- 跨网络 chunk 的不完整事件和不完整行。
- `event` 与 `data` 行。
- `[DONE]` 或等价结束标记。
- 上游 error event。
- 连接提前关闭、空响应、解析失败和本地超时。

图片提取优先支持已确认的 base64 或 data URL 字段；如果上游只返回 URL，后端下载并重新校验后转换为受控 data URL。提取到 partial image、未知 MIME 或不可解码内容时返回失败。

## 8. 错误模型

至少使用以下错误码：

```text
INVALID_IMAGE
IMAGE_TOO_LARGE
INVALID_SCENE
MODEL_NOT_CONFIGURED
RESPONSES_NOT_SUPPORTED
IMAGE_TOOL_NOT_SUPPORTED
ANALYSIS_FAILED
ANALYSIS_INVALID_OUTPUT
IMAGE_GENERATION_FAILED
UPSTREAM_AUTH_FAILED
UPSTREAM_RATE_LIMITED
UPSTREAM_TIMEOUT
UPSTREAM_CONNECTION_FAILED
UPSTREAM_INVALID_IMAGE
UPSTREAM_EMPTY_IMAGE
IMAGE_DECODE_FAILED
```

日志只记录 request id、阶段、耗时、HTTP status 和错误类别，不记录 API key、完整 data URL、完整 prompt 或用户敏感描述。

## 9. 前端交互

页面输入区：

- 单图拖拽或选择上传，复用照片点评的图片校验模式。
- 场景选择默认“通用优化”。
- 照片描述可选，限制长度并显示计数。
- 提交按钮文案为“分析并优化”。提交中禁止替换图片和重复提交。

处理中显示：

1. 分析原图。
2. 整理优化方向。
3. 生成优化图。
4. 接收并处理结果。

结果区显示：

- 原图与结果图并列或滑块对比。
- 结构化优化方向摘要。
- 下载生成图按钮。
- AI 重绘免责声明：可能改变人物、文字、物体边缘和背景细节。
- 失败时保留原图、场景和描述，并提供手动重试。

## 10. 测试与真实联调

单元测试：

- 图片和场景校验。
- 阶段一 JSON 解析和 schema 校验。
- 场景 prompt 组装、`preserve`、`avoid` 和裁切要求。
- SSE 跨 chunk 解析、结束事件和 error event。
- 图片 data URL、base64、URL 下载和解码校验。
- HTTP status 到错误码的映射。

API 测试：

- 缺少配置时不发起上游请求。
- 非法图片和非法场景被拒绝。
- 阶段一失败不会调用生图。
- 阶段一输出异常被拒绝。
- Responses SSE 成功返回图片。
- 上游鉴权、限流、超时、连接中断和空图片返回明确错误。

浏览器验收：

- 布局 A 在桌面和移动宽度可用。
- 11 个固定场景均可选择。
- 上传、提交禁用、四阶段状态、结果对比、下载和手动重试正常。
- 前端网络请求不包含 API key。

真实联调必须使用管理员实际配置的 `base_url`、API key、文本模型 ID 和可选 `image_model`，确认完整组合：

```text
Responses API + image_generation + image input + SSE + final image output
```

## 11. 验收条件

只有以下条件全部满足，工具状态才可从 placeholder 切换为 active：

- 后端和前端 build 通过。
- 单元测试和 API 测试通过。
- 配置能力测试能区分支持与不支持 Responses API 的上游。
- 真实配置完成一次成功的两阶段调用。
- 生成图片可在浏览器展示、下载且可解码。
- 失败不自动重试，前端可手动重试。
- 日志和前端请求不泄露 API key、完整图片和敏感 prompt。
- 照片点评仍保持独立工具并通过原有验证。
