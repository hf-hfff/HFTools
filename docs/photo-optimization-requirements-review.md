# 照片 AI 优化需求评审

- 评审日期：2026-09-14
- 评审范围：仅评审需求与技术可行性，不进行代码开发
- 目标功能：上传单张照片，由文本/多模态模型分析原图并生成优化提示词，再通过 Responses API 的 `image_generation` tool 完成原图重绘
- 参考项目：[RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio)

## 1. 结论

### 1.1 需求方向可行，但原始需求还不能直接进入开发

“先分析、后重绘”的两阶段流程与 HFTools 当前架构匹配：

1. 使用已有 `llm` 配置对原图进行多模态分析。
2. 将分析得到的优化方向整理为最终 image prompt。
3. 使用配置的 Responses API，以文本模型调用内置 `image_generation` tool。
4. 从 SSE 事件中提取最终图片并返回前端。

但需求中有三个必须先固化的前提：

- 模型 ID 由管理员自行配置，系统不预设 `gpt-5.6` 或其他具体名称；所配置的文本模型必须支持图片输入和 `image_generation` tool。
- “Responses API 可调用 `image_generation`”不是所有 OpenAI-compatible 中转站都实现的能力。必须用当前 `base_url + API key + 文本模型`完成真实连接测试，确认 `/v1/responses`、SSE、tool、图片输入和图片输出均可用。
- Image-Studio 是桌面客户端，不是可供 HFTools 调用的生图服务。可借鉴其协议处理、SSE 解析、重试和错误归因思路，但不应把 Image-Studio 作为运行时组件或直接复制其代码。

### 1.2 推荐的 MVP 范围

第一版建议只实现以下闭环：

- 单张 `jpg/png/webp` 图片。
- 图片大小沿用照片点评的前端上限，并在后端再次校验。
- 用户选择一个优化场景：通用优化、小红书、朋友圈、抖音、视频封面或配图、旅行记录、人物肖像、商品展示、餐饮美食、风景摄影、作品集。
- 用户填写可选照片描述。
- 后端先执行一次多模态分析，再执行一次 Responses API 图像生成。
- 每次只生成一张结果图。
- 前端展示原图、优化结果、优化方向摘要，并支持下载结果。
- 不保存原图、结果图、用户描述和完整 prompt 到数据库。
- 第一版不做 mask、局部重绘、多图参考、批处理、历史记录、手工参数面板和多结果比较。

## 2. 现有 HFTools 基础

当前项目已经具备可复用的基础：

- 前端使用 Vue3 + Vite + Element Plus，照片点评页已有单图上传、data URL 预览、拖拽上传、大小/格式校验和等待态。
- Node.js 是统一 API gateway，所有 AI 请求经过后端，前端不接触 API key。
- SQLite 已有 `llm`、`image-gen`、`dify` 三类模型配置，API key 使用 AES 加密落盘。
- `photo-review.service.ts` 已实现 OpenAI-compatible 多模态 `chat/completions` 调用。
- 当前 `llm-client.service.ts` 仅支持非流式 `chat/completions`，不能直接承载 Responses API、SSE 或 `image_generation` tool。
- 照片 AI 优化当前仍是 placeholder，因此可以在不破坏照片点评协议的前提下新增独立 service 和路由。

现有代码参考：

- [photo-review.service.ts](../server-node/src/services/photo-review.service.ts)
- [llm-client.service.ts](../server-node/src/services/llm-client.service.ts)
- [model-configs.service.ts](../server-node/src/services/model-configs.service.ts)
- [PhotoReviewView.vue](../frontend/src/views/PhotoReviewView.vue)
- [AGENTS.md](../AGENTS.md)

## 3. Image-Studio 项目分析

### 3.1 项目定位

Image-Studio README 将项目定位为开源图像生成/编辑客户端，技术栈为 Wails、Go、React/TypeScript，并支持两类上游协议：

- Responses API：请求 `/v1/responses`，使用模型内置的 `image_generation` tool，支持 HTTP SSE 和 WebSocket mode。
- Images API：标准 `/v1/images/generations` 与 `/v1/images/edits`。

该项目自身不提供默认上游，也不替用户提供模型或 API key。用户仍需要配置自己的 `BASE_URL`、API key、文本模型 ID 和图像模型 ID。因此它解决的是客户端调用和长连接处理问题，不是“没有生图模型 key 时免费获得生图能力”。

来源：

- [Image-Studio README](https://github.com/RoseKhlifa/Image-Studio)
- [Image-Studio usage.md](https://github.com/RoseKhlifa/Image-Studio/blob/main/docs/usage.md)
- [Image-Studio features.md](https://github.com/RoseKhlifa/Image-Studio/blob/main/docs/features.md)
- [Image-Studio project-structure.md](https://github.com/RoseKhlifa/Image-Studio/blob/main/docs/project-structure.md)

### 3.2 对 HFTools 有价值的内容

建议提取为“协议和设计要求”，而非直接复用源码：

1. **Responses API 传输模式**
   - 使用 `/v1/responses`。
   - 通过 `image_generation` tool 触发生图。
   - 使用 SSE 接收持续事件，降低长时间推理期间的空闲连接断开风险。
   - 后端需要处理正常结束、错误事件、连接中断、超时和取消。

2. **原始 prompt 传递策略**
   - Image-Studio 的 `no-prompt-revision` 文档提出，在 Responses API 顶层加入指令，要求文本模型将用户 prompt 原样传给 `image_generation`，不重写、不扩写、不润色。
   - 该策略适合 HFTools：第一阶段已经负责生成结构化优化方向，第二阶段不应再次让文本模型自由改写，避免摄影意图和平台场景发生漂移。
   - 这只是 instructions 层面的约束，不是上游强制保证，验收时仍需检查实际请求和响应。

3. **错误归因和长请求处理**
   - 需要区分 `401/403`、`429`、`5xx`、`524/504`、SSE 解析失败、上游未返回图片和本地超时。
   - Image-Studio 文档强调应查看 raw response，而不能只依赖页面 toast。HFTools 可将脱敏后的错误类别返回前端，并将完整密钥、图片内容和敏感 prompt 排除在日志之外。

4. **模型能力验证**
   - 上游配置保存后应支持“测试连接”。
   - 测试不能只验证 `/v1/models` 可访问，还应验证当前文本模型是否能通过 Responses API 调用 `image_generation`，以及是否支持输入参考图。

5. **图片输出处理**
   - 结果可能以最终图片 base64 事件、图片数据字段或上游兼容层的其他字段返回。
   - 需求必须将“支持的上游响应字段”明确为适配层契约，不能假定所有中转站完全遵循同一个响应结构。

### 3.3 不建议直接提取的内容

- 不建议将 Image-Studio 的 Go client、Wails backend 或 React 前端复制到 HFTools。HFTools 已有 Node gateway 和 Vue 前端，复制会引入重复运行时与维护边界。
- 不建议在 HFTools 中启动 Image-Studio 桌面程序后通过进程或文件交换调用。这不符合当前本地服务架构，也会使 API key、任务状态和错误处理分散。
- 不建议直接复制 `AGPLv3` 代码到当前项目，除非先完成许可证兼容审查并接受相应源码公开和界面法律通知义务。

## 4. 推荐业务流程

```text
用户上传单张照片
        |
        v
后端校验格式、大小、解码能力
        |
        v
阶段一：多模态 LLM 分析原图
输入：原图 + 照片描述 + 优化场景
输出：结构化优化方向
        |
        v
后端校验并组装最终 image prompt
        |
        v
阶段二：Responses API
文本模型 + image_generation tool + 原图 + 最终 prompt
        |
        v
SSE 解析并提取最终图片
        |
        v
返回优化方向、最终 prompt 摘要、结果图片
```

### 4.1 阶段一：分析输出契约

不建议让阶段一只返回自由文本。建议要求模型输出 JSON，并由后端进行 schema 校验：

```json
{
  "summary": "照片现状摘要",
  "directions": {
    "crop": "裁切与构图建议，可为空",
    "tone": "色调与色彩建议，可为空",
    "brightness": "亮度、对比度、曝光建议，可为空",
    "content": "主体、背景、干扰物、细节处理建议，可为空",
    "style": "整体风格建议，可为空",
    "platform": "面向所选平台的呈现建议，可为空"
  },
  "preserve": ["必须保留的主体、人物身份、关键物体或文字"],
  "avoid": ["不得发生的改变或伪造内容"]
}
```

要求：

- 每个方向均为非必填，模型判断没有必要调整时返回空字符串或空数组。
- `preserve` 必须强调“保持主体身份、关键内容和真实语义”，避免重绘时过度改变原图。
- `avoid` 用于约束人脸、手指、文字、品牌标识、建筑结构等高风险内容。
- 如果 JSON 解析失败，第一版应直接报“分析结果不可用”，不应盲目把未校验的自由文本拼入生图 prompt。

### 4.2 场景定义

本次直接提供以下固定场景：

| 场景 | 目标 | 默认倾向 |
| --- | --- | --- |
| 通用优化 | 提升照片完成度，保留真实感 | 构图、曝光、色彩、主体清晰度综合调整 |
| 小红书 | 适合图文内容流和封面展示 | 视觉吸引力、主体突出、清爽明亮、适合竖版裁切 |
| 朋友圈 | 适合个人社交分享 | 自然、真实、不过度磨皮和过度饱和 |
| 抖音 | 适合短视频内容发布 | 小尺寸可识别、主体醒目、对比适中、竖版优先 |
| 视频封面或配图 | 适合视频封面、文章配图等内容场景 | 小尺寸可识别、主体醒目、对比适中、竖版优先 |
| 旅行记录 | 适合旅行见闻和地点分享 | 保留环境特征，强化空间层次、天气氛围和地点辨识度 |
| 人物肖像 | 适合个人肖像和人像作品 | 保持人物身份与自然肤质，优化光影、背景分离和神态表现 |
| 商品展示 | 适合商品介绍和销售展示 | 准确保留商品外观、颜色、材质和品牌信息，突出主体并减少背景干扰 |
| 餐饮美食 | 适合菜品、饮品和餐厅内容 | 保持食物真实形态，优化色泽、质感、明暗层次和画面洁净度 |
| 风景摄影 | 适合自然与城市风景展示 | 优化景深层次、动态范围、色彩关系和视觉引导，避免不真实的过度饱和 |
| 作品集 | 适合摄影作品展示和专业呈现 | 强调整体完成度、风格一致性、细节质量和克制的后期处理 |

以上场景均为独立固定选项，不允许用户输入任意平台名称直接影响 prompt。

场景作为“优化目标”，不默认强制改变原图宽高。裁切方向参与最终 image prompt，由生成模型在原图重绘时实际执行；具体裁切比例和主体保留规则需由阶段一分析结果明确，降低主体被截断的风险。

### 4.3 阶段二：Responses API 生图契约

推荐的适配层输入：

```text
model: 已验证具有 image_generation tool 能力的文本模型
image_model: 上游 image_generation tool 使用的图像模型标识（若上游要求）
input: 原图 + 最终 image prompt
instructions: 要求将最终 prompt 原样传递给 image_generation，不要改写
tools: image_generation
stream: true
```

具体字段名称必须以实际上游兼容实现为准。需求不得把某一中转站的私有扩展字段写成通用协议。

后端适配层至少需要定义：

- `createImageGenerationRequest()`：构建请求，不记录 API key。
- `parseResponsesSse()`：逐事件读取，处理跨 chunk 的不完整行。
- `extractGeneratedImage()`：从最终图片事件或兼容字段提取 base64/URL。
- `classifyUpstreamError()`：统一映射错误码。
- `AbortController`：支持请求超时和用户取消。

结果优先返回后端托管的短期资源或受控 data URL。若返回上游 URL，必须确认其有效期、是否需要鉴权以及前端是否可访问；不能把带有 API key 或永久可公开访问假设的上游地址直接暴露给前端。

## 5. 配置设计建议

### 5.1 仅支持 Responses API 的配置要求

照片 AI 优化使用现有 `image-gen` 配置项，但本功能的调用模式固定为 Responses API 调用文本模型内置的 `image_generation` tool，不支持传统 Images API 或其他独立生图 API。项目内不新增 `responses-image` 或等价的独立配置项。模型 ID 和 image model ID 均由管理员自行配置，系统不写死 `gpt-5.6` 或其他具体模型名称。

配置要求如下：

- `base_url`：默认由用户自行配置；管理端必须明确提醒所填 API 服务需支持 `/v1/responses`。
- API key：默认由用户自行配置并加密保存，仅后端使用；管理端必须提醒该 key 需具备 `image_generation` 调用权限。
- 文本模型 ID：默认由用户自行配置；管理端必须提醒所选模型需同时支持图片输入和 `image_generation` tool。
- `image_model`：可选，由管理员配置；如果实际使用的上游要求单独传递该字段，则必须填写，否则照片 AI 优化不可用。
- API mode：固定为 `responses-image-tool`，不提供传统 Images API 选项。
- 传输模式和超时策略：按 Responses API 的 SSE 调用要求配置或使用系统默认值。

不能仅依赖“模型名称看起来像 gpt”来判断调用方式。

### 5.2 管理端需要的验证项

保存模型配置前或保存后，应允许管理员验证：

1. `base_url` 是否可访问。
2. API key 是否有权限访问 Responses API。
3. 文本模型是否可调用 `image_generation`。
4. 是否支持图片输入。
5. 是否返回 SSE 事件。
6. 是否能提取最终图片。

连接测试应使用低成本、低分辨率、明确标记为测试的请求，并向管理员展示费用和配额风险提示。没有确认实际供应商计费规则前，不应承诺“无需生图模型 key”或“不会产生生图费用”。

## 6. 输入、输出和错误边界

### 6.1 输入校验

- 只接受单张 `jpeg/png/webp`。
- 后端重新校验 MIME、base64 前缀、解码结果和大小，不能只信任前端。
- 限制照片描述长度，沿用或小幅扩展现有 500 字上限。
- 场景必须是后端白名单值。
- 不接受用户直接提交任意 `base_url`、模型名称或 tool 参数。
- 不允许前端提交 API key。

### 6.2 输出校验

- 必须确认输出是真实可解码的图片。
- 限制输出格式和最大体积。
- 只允许返回 `image/png`、`image/jpeg`、`image/webp` 等白名单类型。
- 若只收到 partial image，第一版建议判定为失败，不要默认把不完整图片当作成功结果。
- 结果图应标识为 AI 优化结果，并在页面提供“可能改变细节、文字、人物特征或背景”的提示。

### 6.3 错误分类

建议至少覆盖：

- `INVALID_IMAGE`
- `IMAGE_TOO_LARGE`
- `INVALID_SCENE`
- `MODEL_NOT_CONFIGURED`
- `RESPONSES_NOT_SUPPORTED`
- `IMAGE_TOOL_NOT_SUPPORTED`
- `ANALYSIS_FAILED`
- `ANALYSIS_INVALID_OUTPUT`
- `IMAGE_GENERATION_FAILED`
- `UPSTREAM_AUTH_FAILED`
- `UPSTREAM_RATE_LIMITED`
- `UPSTREAM_TIMEOUT`
- `UPSTREAM_CONNECTION_FAILED`
- `UPSTREAM_INVALID_IMAGE`
- `UPSTREAM_EMPTY_IMAGE`
- `IMAGE_DECODE_FAILED`

前端应区分“分析失败”和“重绘失败”：分析失败时不应进入第二阶段；重绘失败时可以展示已经生成的优化方向，并允许用户重试重绘，而不必再次执行分析。

## 7. 交互需求建议

### 7.1 页面输入

- 单图上传区域，沿用照片点评的拖拽、选择和预览能力。
- 优化场景选择器，默认“通用优化”。
- 照片描述输入框，说明可填写拍摄意图、人物身份、希望保留的内容和发布场景。
- 可选的“更偏向真实修图 / 更偏向创意重绘”控制不建议在 MVP 暴露；该选项会显著扩大 prompt 和验收复杂度。
- 提交按钮文案应明确包含“分析并优化”，提交期间禁止替换图片和重复提交。

### 7.2 处理中状态

应展示当前阶段：

1. 分析原图。
2. 整理优化方向。
3. 调用图像生成。
4. 接收并处理结果。

SSE 的中间事件不应原样展示给普通用户；只展示稳定、可理解的阶段状态。前端超时提示应说明是“连接超时、上游仍可能在处理”，系统不自动重试；用户可在错误提示中手动再次发起重绘。

### 7.3 结果展示

- 原图与结果图并列或滑块对比。
- 展示结构化优化方向，允许用户理解模型做了什么。
- 默认不展示完整系统 prompt 和 API 原始响应。
- 提供下载按钮。
- 失败时保留用户输入和原图预览，允许重试。
- 页面明确提示：AI 重绘不是无损修图，可能改变人物、文字、物体边缘和背景细节。

## 8. 验收标准

### 8.1 功能验收

- 可上传一张合法照片并预览。
- 不允许提交第二张图片、空图片、超限图片和不支持格式。
- 可选择通用优化、小红书、朋友圈、抖音、视频封面或配图、旅行记录、人物肖像、商品展示、餐饮美食、风景摄影、作品集。
- 可填写照片描述，也可不填写。
- 阶段一能返回符合 schema 的优化方向。
- 阶段二能使用原图和最终 prompt 调用 Responses API 的 `image_generation`。
- 能处理 SSE 分片并获得最终图片。
- 结果图能在浏览器正确展示和下载。
- 分析失败、生成失败、鉴权失败、限流、超时和空图片均有明确提示。
- 前端网络请求中不出现 API key。

### 8.2 质量验收

至少准备以下测试图片：人物、风景、美食、建筑、包含文字的照片。每类检查：

- 主体是否仍然存在并保持语义。
- 人脸、手部和关键物体是否出现明显变形。
- 原图文字是否被错误重绘。
- 色调和亮度是否符合场景目标。
- 是否出现不必要的内容新增。
- 结果尺寸和格式是否符合约定。

“优化成功”不能只以 HTTP 200 判断，至少需要同时满足：响应成功、拿到图片字段、图片可解码、前端可展示。

### 8.3 配置验收

- 没有配置或配置不完整时，不发送上游请求。
- 配置测试能区分“文本模型可用”和“文本模型可调用 image_generation”。
- 使用同一 `base_url + key` 时，若上游仅支持 `chat/completions`，页面应明确提示不支持本功能，而不是返回通用 500。
- 日志不打印 API key、完整图片 data URL 或完整用户隐私描述。

## 9. 主要风险与处理建议

| 风险 | 影响 | 建议 |
| --- | --- | --- |
| 上游只兼容 `chat/completions`，不支持 Responses API | 功能无法调用 | 管理端增加能力测试；保留明确的“不支持”错误 |
| `gpt-5.6` 或 image tool 模型 ID 不存在/无权限 | 请求失败或模型找不到 | 以实际上游模型列表和真实测试为准，不在代码中写死未经确认的名称 |
| Image-Studio 的实现与当前上游中转站字段不一致 | SSE 或图片提取失败 | 建立 provider adapter，并保存脱敏 raw response 结构用于排错 |
| Responses 请求耗时长 | 前端超时、网关断开、重复计费 | SSE 保活、后端超时/取消、幂等或重复提交保护；系统不自动重试，前端报错并允许用户手动再次重试 |
| 文本模型二次改写 prompt | 生成结果偏离分析方向 | 使用 VERBATIM instructions，并在测试中检查实际 prompt 传递 |
| 原图和生成图被记录到日志 | 隐私泄露、日志膨胀 | 默认不记录图片；日志仅记录 request id、阶段、耗时、错误类别和状态码 |
| 直接复制 AGPLv3 源码 | 许可证合规风险 | 仅借鉴公开协议和架构；如需复制代码，先进行许可证审查 |
| 生成结果包含错误文字、人物或品牌内容 | 用户体验和合规风险 | 在分析阶段输出 `preserve/avoid`；结果页展示 AI 重绘免责声明 |
| 用户不知道可能产生费用 | 费用和配额风险 | 配置测试、页面提交和文案中明确上游计费由供应商决定 |

## 10. 待确认问题

以下条目分为已确定的配置规则和需要在开发时验证的协议细节：

1. `base_url` 默认由用户自行配置；管理端必须明确提醒所填 API 服务必须支持 `/v1/responses`，并提供能力测试验证。
2. 文本模型 ID 默认由用户自行配置；管理端必须提醒所选模型必须支持图片输入和 `image_generation` tool，系统不预设某个固定模型名称。
3. Responses API 请求中是否需要单独传递 `image_model`，准确字段名是什么？该字段由用户自行配置，可不填写；如果上游要求该字段而未填写，则照片 AI 优化功能不可用，具体字段结构在开发时确认。
4. 上游返回最终图片的 SSE event type 和字段结构是什么？是否可能只返回图片 URL？待开发时根据实际上游确认。
5. 该上游是否允许把原图以 data URL 作为 input image？图片大小、分辨率和格式限制暂时不在需求层限制，待开发时根据实际上游确认。
6. 上游是否支持通过文本模型的 key 调用 `image_generation`？本需求按“支持”设计，但仍需在开发时通过真实能力测试验证。
7. 失败重试是否会重复计费？系统不自动重试，前端展示错误并允许用户手动再次重试。
8. 是否接受“不保存任何历史结果”的当前架构约束？接受。
9. “裁切”仅生成裁切建议，还是要让模型实际改变画布比例？裁切方向参与模型实际生图，由生成模型依据阶段一结果执行；具体画布比例和输出约束待开发时确认。
10. 是否需要保留“原图点评”与“照片 AI 优化”两个独立工具？需要，两个功能保持独立。
11. 是否接受 Image-Studio `AGPLv3` 许可证带来的合规约束？接受；本评审仍建议仅借鉴协议和架构，不直接复制其源码。

## 11. 推荐开发拆分

需求确认后，建议按以下顺序实现：

1. 定义 Responses API provider adapter 和 SSE 事件契约。
2. 在管理端增加 Responses API 能力测试，不先改用户页面。
3. 实现阶段一照片分析 service，固定 JSON schema 和错误处理。
4. 实现阶段二 Responses API 图像生成 service，完成图片提取和解码校验。
5. 增加独立后端路由，先用 API 集成测试验证完整闭环。
6. 将 placeholder 页面替换为照片优化页面。
7. 完成真实上游和浏览器端验收，再将工具状态从 placeholder 切为 active。

## 12. 评审结论摘要

- 需求业务价值明确，流程也符合项目既定的“LLM 分析 + 图像重绘”架构。
- Image-Studio 可提供有价值的 Responses API、SSE、重试和错误处理参考，但它不能替代上游模型，也不是 HFTools 的运行时依赖。
- 关键技术风险不在 Vue 页面，而在上游是否真实支持 `Responses API + image_generation + image input + SSE` 的组合能力。
- 第一版应优先验证真实上游能力，再实现两阶段业务流程；不能因为 Image-Studio 能运行就推断当前 API key 一定可用。
- 在许可证层面，推荐协议级借鉴，不直接复制 `AGPLv3` 源码。
