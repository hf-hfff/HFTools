# 模型配置 v2 · 技术方案

- 状态：**已实施，待真实 AI 调用与浏览器验收**
- 日期：2026-10-27
- 上游依据：`docs/model-config-iteration-requirements.md`（D1–D8 全部确认）
- 范围：管理平台「模型配置」单页 + 服务端配置/客户端调用层 + 一次启动迁移
- 不含：部署、线上数据操作、真实付费调用（除非你另行授权）

---

## 1. 变更总览

| 维度 | 现状 | 目标 |
| --- | --- | --- |
| 配置表 | `model_configs`，`type` 主键，llm / image-gen / dify 三行 | 新表 `model_config`，单行 `id=1` |
| 配置接口 | `GET /model-configs` 返回数组；`PUT /model-configs/:type` | `GET/PUT /model-config` 单对象 |
| 模型字段 | `models: string[]`（只用 `[0]`） | `default_model` + `image_model`（可空） |
| 生图模型传参 | 顶层 `image_model`（非标准，可能被忽略） | `tools[0].model`（标准写法） |
| 推理强度 | 无 | `reasoning_effort`：low / medium / high，默认 medium |
| 能力测试 | `POST /model-configs/test-responses` | 移除（D7） |
| dify | 独立配置行 + 前端卡片 | 删除类型与数据 |

---

## 2. 数据层

### 2.1 建表

```sql
CREATE TABLE IF NOT EXISTS model_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL DEFAULT 'openai',
  base_url TEXT,
  api_key TEXT,              -- AES-256-GCM 密文，与旧表同算法
  default_model TEXT,
  image_model TEXT,          -- NULL = 跟随系统默认（gpt-image-2）
  reasoning_effort TEXT,     -- low | medium | high，默认 medium
  updated_at TEXT
);
```

放在 `db/index.ts` 的 `initTables()` 内，`CREATE TABLE IF NOT EXISTS` 保证幂等。

### 2.2 迁移（启动时执行一次）

用 SQLite 原生 `PRAGMA user_version` 做版本标记，不额外建元数据表。

```ts
const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
if (v < 1) {
  const run = db.transaction(() => {
    const llm = getLegacy('llm');
    const img = getLegacy('image-gen');
    const primary = llm ?? img;

    const defaultModel = firstModel(llm?.models) || firstModel(img?.models) || null;
    const imageModel = img?.image_model?.trim() || null;

    db.prepare(
      `INSERT INTO model_config
         (id, provider, base_url, api_key, default_model, image_model, reasoning_effort, updated_at)
       VALUES (1, 'openai', ?, ?, ?, ?, 'medium', ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(primary?.base_url ?? null, llm?.api_key ?? img?.api_key ?? null,
          defaultModel, imageModel, new Date().toISOString());

    db.prepare("DELETE FROM model_configs WHERE type = 'dify'").run();

    console.log('[migrate] model_config v1 完成',
      `default_model=${defaultModel ?? 'null'}`,
      `image_model=${imageModel ?? 'null'}`);
    db.pragma('user_version = 1');
  });
  run();
}
```

关键约束：
1. `api_key` **密文直搬**，不解密、不重新加密（`SECRET_KEY` 变过也能迁）
2. 没有任何旧行时也插入 `id=1` 的空壳行，保证 GET 永远返回结构稳定的对象
3. `dify` 行删除前，将 `{type, base_url, models, updated_at}` 写入日志（**不含 api_key**）
4. 迁移在事务内；失败整体回滚，不会留下半迁移状态
5. 旧表 `model_configs` 与 `llm` / `image-gen` 行**原样保留**，仅用于追溯；新代码不再读写

### 2.3 回滚

旧表数据仍在，但 `dify` 行已删且旧代码读的是旧表（新配置不会回流）。因此回滚方式是**恢复备份文件**：

```bash
cp server-node/data/hftools.db server-node/data/hftools.db.bak-20261027   # 迁移前
```

把 `PRAGMA user_version` 改回 0 不作为回滚手段（会造成新旧表数据不一致）。

---

## 3. 服务层

### 3.1 `model-configs.service.ts`（重写）

```ts
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** 管理端视图：api_key 已脱敏；image_model 保持原始 null（UI 用 placeholder 表达默认） */
export interface ModelConfigView {
  provider: 'openai';
  base_url: string | null;
  api_key: string | null;
  default_model: string | null;
  image_model: string | null;
  reasoning_effort: ReasoningEffort;
  updated_at: string | null;
}

/** 调用端视图：image_model 已应用回退，永不为空 */
export interface ResolvedModelConfig {
  base_url: string | null;
  api_key: string | null;
  default_model: string | null;
  image_model: string;
  image_model_configured: boolean;
  reasoning_effort: ReasoningEffort;
}

export function getModelConfig(): ModelConfigView;
export function getResolvedConfig(): ResolvedModelConfig;
export function saveModelConfig(input: SaveModelConfigInput): ModelConfigView;
```

`SaveModelConfigInput` 语义（沿用现有"字段未提供即不变"）：

| 字段 | 未提供 | 提供空值 | 提供值 |
| --- | --- | --- | --- |
| `base_url` | 不变 | 清空 | 去尾斜杠后保存 |
| `api_key` | 不变 | 清空 | 加密保存 |
| `default_model` | 不变 | 清空 | trim 保存 |
| `image_model` | 不变 | 清空（存 NULL） | trim 保存 |
| `reasoning_effort` | 不变 | 400 | 必须是三个枚举之一 |

读取时 `reasoning_effort` 为空或非法值 → 归一为 `'medium'`（容错，不抛错）。

### 3.2 新文件 `model-capabilities.ts`

```ts
/** 推理模型前缀判定：仅用于请求期参数整形，不做保存前校验（D7） */
const REASONING_MODEL_RE = /^(o[1-9](?:-|$)|gpt-5(?:\.\d+)?(?:-|$))/i;
export function supportsReasoning(model: string): boolean {
  return REASONING_MODEL_RE.test(model.trim());
}
```

> `o1-mini` 等个别模型对 `reasoning_effort` 支持不一致，白名单可在联调后收窄，属常量级修改。

### 3.3 `llm-client.service.ts`

- `LlmClientConfig` 改为 `{ base_url, api_key, model, reasoning_effort? }`，删除 `models: string[]`
- 请求体：

```ts
const body: Record<string, unknown> = { model: config.model, messages, stream: false };
if (config.reasoning_effort && supportsReasoning(config.model)) {
  body.reasoning_effort = config.reasoning_effort;
}
```

- `model` 为空 → 保留 `MODEL_NOT_CONFIGURED`，文案改为"模型服务尚未配置默认模型"
- 其它错误分类（超时/鉴权/限流/空内容）保持不变，避免影响既有前端提示

### 3.4 `responses-image.client.ts`

```ts
tools: [{ type: 'image_generation', model: input.imageModel }]   // 标准写法，唯一来源
```

- 删除顶层 `body.image_model = imageModel`
- `input.imageModel` 必填（调用方保证已回退到 `DEFAULT_IMAGE_MODEL`）
- 生图请求**不带** `reasoning` / `reasoning_effort`
- 驱动模型 `input.model` 取 `default_model`

### 3.5 调用端改造

| 文件 | 改动 |
| --- | --- |
| `photo-review.service.ts:57` | `getDecryptedConfig('llm')` → `getResolvedConfig()`；校验 `base_url/api_key/default_model`；`chatCompletion({ ...cfg, model: cfg.default_model })` |
| `prompt-optimize.service.ts:68` | 同上 |
| `photo-optimize.service.ts:167,405` | 阶段一与阶段二共用一次 `getResolvedConfig()`；删除 `ImageGenConfigView` / `readImageGenConfig` |
| `photo-optimize.service.ts:419` | `PhotoOptimizeStages.readImageConfig` 改为 `readConfig?: () => ResolvedModelConfig`（注入点保留，便于冒烟） |
| `photo-optimize.service.ts:500` | `requireImageGenConfig` → `requireModelConfig`：缺 `base_url/api_key` → "模型服务尚未配置"；缺 `default_model` → "模型服务尚未配置默认模型" |
| `photo-optimize.service.ts:536` | 生图调用传 `model: cfg.default_model`、`imageModel: cfg.image_model` |
| `routes/ai.ts:14` | 删除 `TASK_CONFIG_TYPE` 与 dify 映射；通用入口统一校验新配置，仍返回 501 |

所有面向用户的错误文案去掉 `（llm）` / `（image-gen）` 后缀。

---

## 4. 接口契约

鉴权：除 login 外均需 `Authorization: Bearer <jwt>`。响应统一 `{ code, message, data }`。

### 4.1 `GET /api/admin/model-config`

```json
{
  "code": "OK", "message": "ok",
  "data": {
    "provider": "openai",
    "base_url": "https://api.openai.com/v1",
    "api_key": "sk-****abcd",
    "default_model": "gpt-5.1",
    "image_model": null,
    "reasoning_effort": "medium",
    "updated_at": "2026-10-27T06:12:00.000Z"
  }
}
```

### 4.2 `PUT /api/admin/model-config`

请求体（全部可选）：

```json
{
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "default_model": "gpt-5.1",
  "image_model": "",
  "reasoning_effort": "high"
}
```

校验规则：
- `base_url` 非空时必须匹配 `^https?://`，去尾部 `/`；否则 `400 INVALID_BASE_URL`
- `reasoning_effort` 必须是 `low|medium|high`；否则 `400 INVALID_REASONING_EFFORT`
- `default_model` / `image_model` 必须是字符串，trim 后 ≤200 字符
- `image_model` 传 `""` 或 `null` → 存 `NULL`（UI 显示为空，运行时回退默认）
- **不发起任何上游请求**（D7）

### 4.3 `POST /api/admin/model-config/models`

请求体：空对象（**不接受前端传 URL/key**，一律用已保存配置，规避 SSRF）。

```json
{
  "code": "OK", "message": "ok",
  "data": {
    "models": [
      { "id": "gpt-5.1", "kind": "chat" },
      { "id": "gpt-image-2", "kind": "image" }
    ],
    "total": 38,
    "fetched_at": "2026-10-27T06:20:00.000Z"
  }
}
```

服务端流程：
1. 读已保存配置并解密；缺 `base_url` 或 `api_key` → `400 MODEL_NOT_CONFIGURED`
2. 拼 endpoint：`/v1$` → `+ /models`；`/chat/completions$` → 截断后再拼；其它 → `+ /v1/models`
3. `GET`，`Authorization: Bearer`，`AbortSignal.timeout(10_000)`，不重试
4. 解析 `data[].id`；结构不符 → `502 MODEL_LIST_INVALID`
5. 过滤噪声（embedding / tts / whisper / moderation / audio / realtime / transcribe / davinci / babbage），去重排序
6. `kind`：`/gpt-image|dall-e|image/i` → `image`；`/gpt|^o[1-9]|chatgpt/i` → `chat`；其余 `other`
7. 结果**不落库、不做进程内缓存**（D5），每次调用都真实请求上游

### 4.4 错误码

| 场景 | HTTP | code |
| --- | --- | --- |
| 缺配置（无 base_url / key） | 400 | `MODEL_NOT_CONFIGURED` |
| base_url 非法 | 400 | `INVALID_BASE_URL` |
| 推理强度非法 | 400 | `INVALID_REASONING_EFFORT` |
| 上游鉴权失败 | 502 | `UPSTREAM_AUTH_FAILED` |
| 上游不可达 | 502 | `UPSTREAM_UNAVAILABLE` |
| 上游超时 | 504 | `UPSTREAM_TIMEOUT` |
| 上游限流 | 429 | `UPSTREAM_RATE_LIMITED` |
| 模型列表结构异常 | 502 | `MODEL_LIST_INVALID` |

---

## 5. 前端

### 5.1 页面结构

```
┌─ 模型配置 ───────────────────────────────────────────┐
│ ⓘ 当前配置要求（系统不做保存前校验，请自行确认）  [展开] │
│                                                      │
│ Base URL    [ https://api.openai.com/v1           ]  │
│ API Key     [ •••••••• ]  当前：sk-****abcd          │
│ 默认模型    [ gpt-5.1 ▾ ]              [拉取模型]     │
│ 生图模型    [ gpt-image-2 ▾ ]  留空按 gpt-image-2    │
│ 推理强度    ( )低   (•)中   ( )高                    │
│                                                      │
│ 更新于 2026-10-27 14:00                         [保存] │
└──────────────────────────────────────────────────────┘

（拉取后出现在卡片下方，仅本次页面有效）
┌─ 上游模型 38 ────────────────────────────[复制全部]─┐
│ [ 搜索模型… ]                                       │
│ gpt-5.1        chat   [复制]                        │
│ gpt-image-2    image  [复制]                        │
│ …                                                   │
└─────────────────────────────────────────────────────┘
```

### 5.2 状态与交互

```ts
interface FormState {
  baseUrl: string;
  apiKeyInput: string;
  maskedApiKey: string | null;
  defaultModel: string;
  imageModel: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  updatedAt: string | null;
}
const upstreamModels = ref<Array<{ id: string; kind: 'chat' | 'image' | 'other' }>>([]);
const fetchedAt = ref<string | null>(null);
```

- 进入页面：`GET /admin/model-config` 填充，`reasoning_effort` 缺省显示「中」
- **拉取按钮可用条件**：`baseUrl` 与 `maskedApiKey` 均存在，且表单无未保存改动。任一不满足 → 禁用 + tooltip：
  - 无配置：「请先保存 Base URL 与 API Key」
  - 有改动：「请先保存当前修改，再拉取模型」
- 拉取点击 → `POST /model-config/models`；成功写入 `upstreamModels` 并展示计数与时间；失败展示后端 `message`，列表区保持空态
- 模型选择：`el-select filterable allow-create clearable`；`默认模型` 的候选取 `kind !== 'image'`，`生图模型` 的候选取全部（`image` 优先置顶）
- 复制：`navigator.clipboard.writeText(id)`，失败降级 `document.execCommand('copy')`；逐条复制 + 复制全部（`\n` 分隔）
- 保存：`PUT /model-config`；`image_model` 为空串 → 传 `""`（后端存 NULL）；`api_key` 留空 → **不携带该字段**
- 刷新/重进页面：`upstreamModels` 清空（不写 localStorage / sessionStorage / Pinia 持久化）
- 未保存改动判定：对比表单归一化值与载入时快照（trim + 空串等价）

### 5.3 类型与 API 封装

`types/index.ts`：
- 删除 `ModelType`
- 新增 `ReasoningEffort`、`ModelConfigView`（单对象）、`UpstreamModel`
- `ModelConfig` 删除 `type` / `models[]`，增加 `default_model` / `reasoning_effort`

`api/admin.ts`：
- `getModelConfig(): Promise<ModelConfigView>`
- `saveModelConfig(payload): Promise<ModelConfigView>`
- `fetchUpstreamModels(): Promise<{ models: UpstreamModel[]; total: number; fetched_at: string }>`
- 删除 `getModelConfigs` / `testResponsesApi`

---

## 6. 文件清单

| 文件 | 类型 |
| --- | --- |
| `server-node/src/db/index.ts` | 新表 + 迁移 |
| `server-node/src/services/model-configs.service.ts` | 重写 |
| `server-node/src/services/model-capabilities.ts` | 新增 |
| `server-node/src/services/llm-client.service.ts` | 改请求体与配置类型 |
| `server-node/src/services/responses-image.client.ts` | 工具内模型 |
| `server-node/src/services/photo-review.service.ts` | 取配置 |
| `server-node/src/services/prompt-optimize.service.ts` | 取配置 |
| `server-node/src/services/photo-optimize.service.ts` | 取配置 + 错误文案 |
| `server-node/src/routes/admin.routes.ts` | 3 端点，删 2 个 |
| `server-node/src/routes/ai.ts` | 删 dify 映射 |
| `frontend/src/views/admin/ModelsView.vue` | 重做 |
| `frontend/src/types/index.ts` | 类型 |
| `frontend/src/api/admin.ts` | 接口封装 |
| `AGENTS.md` 2.3 / 2.4 | 契约与阶段成果同步 |

---

## 7. 验证清单

无自动化测试框架，按「构建 + 手工用例」验收。

**构建**
```bash
cd frontend && pnpm build
cd server-node && npx tsc --noEmit -p tsconfig.json
```

**手工用例矩阵**

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | 首次启动（旧库有 llm + image-gen） | 新表单行，`default_model`=旧 llm 首个模型，`image_model`=旧 image-gen 值，`reasoning_effort`=medium |
| 2 | 再次启动 | 不重复迁移，数据不变 |
| 3 | `dify` 行 | 已删除；日志有摘要且不含 key |
| 4 | GET 配置 | 返回单对象，key 脱敏，`image_model: null` |
| 5 | 保存（不含 key） | key 不变；`updated_at` 更新 |
| 6 | 保存时观察网关日志 | **零上游请求** |
| 7 | `image_model` 留空保存 | 库中 `NULL`；GET 返回 null |
| 8 | 照片 AI 优化 | 请求体 `tools[0].model` = `gpt-image-2`（或已配置值），顶层无 `image_model` |
| 9 | 默认模型 = `gpt-5.1`，推理=高 | `/chat/completions` 带 `reasoning_effort: "high"` |
| 10 | 默认模型 = `gpt-4o`，推理=高 | 请求体无该字段，调用成功 |
| 11 | 未保存配置点拉取 | 按钮禁用 + 提示，无请求 |
| 12 | 有效配置拉取 | 返回列表，含 `gpt-image-*`，可复制单条/全部 |
| 13 | 错误 key 拉取 | 502 `UPSTREAM_AUTH_FAILED`，文案可读 |
| 14 | 拉取后刷新页面 | 列表清空，已保存字段不变 |
| 15 | 照片点评 / 提示词优化 | 均走新配置，文案无 `（llm）` 后缀 |
| 16 | `/api/ai/git-trending` | 仍 501，无 dify 相关文案 |

---

## 8. 实施顺序

| 阶段 | 内容 | 依赖 | 工作量 |
| --- | --- | --- | --- |
| T1 | 建表 + 迁移 + 备份脚本说明 | — | S |
| T2 | 配置服务重写 + 能力判定 + 拉取解析 | T1 | M |
| T3 | 路由替换（3 端点，删 2 个） | T2 | S |
| T4 | 两个客户端改造（chat reasoning / image tool model） | T2 | S |
| T5 | 三个业务服务与 ai.ts 取配置改造 | T2 T4 | M |
| T6 | 前端单卡片重做 + 拉取/复制/告知块 | T3 | M |
| T7 | 构建、手工用例矩阵、`AGENTS.md` 同步 | 全部 | S |

T1–T5 后端可独立自测（curl），T6 完成后走完整回归。

---

## 9. 风险与待联调

| 项 | 说明 | 处理 |
| --- | --- | --- |
| `gpt-image-2` 是否真实存在 | 默认值取自需求，若上游无此模型则出图必失败 | 常量单点定义，联调确认后一行可改 |
| 中转站是否认 `tools[0].model` | 只保留标准写法（已确认），部分中转可能只读顶层字段 | 不支持的中转即不在本次支持范围；错误会归类为 `IMAGE_TOOL_NOT_SUPPORTED` |
| `o1-mini` 等边界模型 | 前缀白名单可能误判 | 联调后收窄正则 |
| 旧配置一次性迁移 | 迁移后旧表不再更新 | 迁移前备份 DB；发版说明标注 |

---

## 10. 交付后需同步

- `AGENTS.md` 2.3：数据表由"三表三类配置"改为"`model_config` 单行"，接口契约改为 3 个端点
- `AGENTS.md` 2.4：追加本次阶段成果行
- 需求文档 §8 的"开发自测项"结论回填（默认模型、生图模型实测结果）

---

## 11. 实施记录（2026-10-27）

| 项 | 结果 |
| --- | --- |
| 数据库备份 | `server-node/data/hftools.db.bak-202610271454` |
| 迁移 | 一次通过，`user_version=1`；旧表保留 `llm` / `image-gen` 两行（本库无 dify 行） |
| 迁移结果 | `default_model=gpt-5.6-terra`、`image_model=gpt-image-2`、`reasoning_effort=medium`、`base_url=https://nowcoding.ai/v1` |
| 真实拉取 | 上游返回 7 个对话模型（`gpt-5.6-*`、`gpt-6*`、`gpt-6.1-*`），**不含任何生图模型** |
| 校验分支 | `INVALID_REASONING_EFFORT` / `INVALID_BASE_URL` 均按预期返回；不带 `api_key` 保存后密文未变、尾斜杠被去除 |
| 构建 | 前端 `pnpm build` 通过；后端 `tsc --noEmit` 通过 |

**新发现**：当前使用的中转 `nowcoding.ai` 的 `/v1/models` 只返回对话模型，不列出生图模型。因此「生图模型」字段无法从拉取结果中选择，只能手填 —— 现有实现已支持 `allow-create`（可直接输入并回车创建），但页面提示语需明确"若列表中无生图模型，请手动输入"。这一点待确认后微调文案。

**未验收**：真实点评 / 提示词优化 / 照片优化调用（涉及付费与出图）；浏览器交互（拉取、复制、保存、刷新清空）。
