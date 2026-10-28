# 影像 AI 重绘 · 技术方案

- 状态：已实施（2026-10-27）
- 日期：2026-10-27
- 上游依据：`docs/image-redraw-requirements-review.md`（29 个缺口已全部关闭）
- 范围：后端（3 张表 / 4 个 service / 1 个路由文件 / 文件存储）+ 前端（1 页 4 组件 / 接口层）+ 工具注册
- 不含：真实付费调用、部署、现有 photo-enhance 页面重构

---

## 1. 变更总览

| 维度 | 现状 | 目标 |
| --- | --- | --- |
| 工具数 | 10 个（3 active） | 11 个（新增 `image-redraw`，active） |
| 图生图能力 | `image-edit.client.ts` 已被 photo-enhance 使用 | 直接复用，不改动 |
| 提示词来源 | 固定场景白名单 | 用户手输 + 自建模板（可追加） |
| 模板存储 | 无 | 新表 `redraw_templates` + `redraw_template_previews` |
| 历史记录 | 全部工具均不落库 | 新表 `redraw_history` + 图片落盘 |
| 图片存储 | 仅 `assets/` 静态资源（只读） | 新增 `data/redraw/` 读写目录 + 专用只读接口 |
| 进度反馈 | photo-enhance 四段时间预估 | 复用机制，重写为 4 段创作语义文案 |
| 新依赖 | — | **无**（不引入 multer / sharp） |

**核心设计取舍**：重绘接口返回图片 URL 而非 base64。

photo-enhance 返回 base64 data URL，但本功能每次都落历史，若再回传 base64，一次请求要传输约 3MB JSON。改为「落盘 → 返回 `/api/redraw/files/...` 的 URL」，前端 `<img src>` 直接加载，同源可下载，且与历史记录天然共用同一份文件。

---

## 2. 数据层

### 2.1 建表

追加到 `server-node/src/db/index.ts` 的 `initTables()`，全部 `CREATE TABLE IF NOT EXISTS`，幂等。

```sql
CREATE TABLE IF NOT EXISTS redraw_templates (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL,
  body  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redraw_templates_name ON redraw_templates(name);

CREATE TABLE IF NOT EXISTS redraw_template_previews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  path        TEXT NOT NULL,
  seq         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_redraw_previews_tpl ON redraw_template_previews(template_id);

CREATE TABLE IF NOT EXISTS redraw_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path   TEXT NOT NULL,
  result_path   TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  template_id   INTEGER,
  source_bytes  INTEGER NOT NULL DEFAULT 0,
  result_bytes  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redraw_history_created ON redraw_history(created_at DESC);
```

设计说明：

1. **不加外键**。`redraw_template_previews.template_id` 与 `redraw_history.template_id` 均不加 `REFERENCES`。原因：SQLite 外键需 `PRAGMA foreign_keys = ON` 才生效，项目未开启；且历史记录不应因模板删除而级联消失。级联清理由 service 层显式处理。
2. **`source_bytes` / `result_bytes` 是为了 2GB 上限**。若每次算目录体积要遍历 `fs.statSync`，代价随记录数线性上升；存字节数后一次 `SUM()` 即可判定。
3. **不动 `PRAGMA user_version`**。只新增表、不改旧表结构，无需迁移版本号。
4. **`prompt` 存实际提交的最终文本**（含追加内容），不是模板原文。

### 2.2 文件目录与命名

```text
server-node/data/redraw/
  previews/   模板示例图   <templateId>-<seq>-<rand>.{jpg|png|webp}
  history/    历史图       <ts>-<rand>-src.{ext} / -out.{ext}
```

- 根目录固定 `path.resolve(dataDir, 'redraw')`，启动时 `fs.mkdirSync(..., { recursive: true })`。
- **只写 `data/`**：`docker-compose.yml` 只有 `./server-node/data:/app/data` 是持久化卷；写 `assets/` 会在镜像重建后丢失。
- DB 中只存相对路径（`redraw/previews/...`），不存绝对路径，避免容器内外路径不一致。
- 文件名用 `Date.now()` + `randomUUID().slice(0, 8)`，避免并发同秒覆盖。
- 扩展名由**解码后的 magic number**判定，不信任前端声明的 MIME。

### 2.3 容量策略

常量集中在 `redraw-history.service.ts`：

```ts
const HISTORY_MAX_ROWS = 100;
const HISTORY_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
```

`enforceCapacity()` 在每次成功写入后执行：

1. `SELECT COUNT(*) FROM redraw_history` → 超 100 条，按 `created_at ASC` 逐条删（先删文件后删行）。
2. `SELECT SUM(source_bytes + result_bytes)` → 超 2GB，同上直到低于阈值。
3. 删除文件失败只记日志，不阻断行删除（避免一条坏文件卡住整个清理）。

---

## 3. 后端服务层

### 3.1 文件清单

| 文件 | 类型 | 职责 |
| --- | --- | --- |
| `db/index.ts` | 改 | `initTables()` 追加 3 张表 + 索引 |
| `db/seed.ts` | 改 | 新增 `image-redraw` 工具；补 `sort_order` 幂等同步 |
| `services/file-store.ts` | 新 | base64 解码落盘、读取、删除、magic number 校验 |
| `services/redraw-templates.service.ts` | 新 | 模板 CRUD + 示例图增删，含数量上限校验 |
| `services/redraw.service.ts` | 新 | 重绘编排：校验 → 调 `images/edits` → 落盘 → 写历史 |
| `services/redraw-prompt-optimize.service.ts` | 新 | 提示词优化（长文本，180s） |
| `services/redraw-history.service.ts` | 新 | 历史查询、删除、容量清理 |
| `routes/redraw.routes.ts` | 新 | 模板 / 历史 / 文件读取 |
| `routes/ai.ts` | 改 | 加 2 条具体的 `/api/ai/*` 路由 |
| `app.ts` | 改 | body limit + 挂载 redrawRouter |

### 3.2 `file-store.ts`

```ts
export interface SavedImage { relPath: string; bytes: number; ext: string }

/** data URL → 校验 → 落盘；返回相对路径与字节数 */
export async function saveDataUrlImage(
  dataUrl: string,
  subdir: 'previews' | 'history',
  filename: string,
): Promise<SavedImage>;

/** 相对路径 → 绝对路径；非法路径抛 INVALID_FILE_PATH */
export function resolveDataPath(relPath: string): string;

/** 删除文件，失败只记日志 */
export async function removeDataFile(relPath: string): Promise<void>;

/** 读取历史图片的总占用 */
export function dirUsage(relPath: string): number;
```

关键点：

- `resolveDataPath` 必须做**路径穿越防护**：
  ```ts
  const abs = path.resolve(DATA_DIR, relPath);
  if (!abs.startsWith(DATA_DIR + path.sep)) throw new ApiError(400, 'INVALID_FILE_PATH', '非法文件路径');
  ```
- magic number 判定复用 `responses-image.client.ts` 已导出的 `detectImageMime()`，避免重复实现。
- 落盘用 `fs.promises.writeFile`，文件名拼接前先 `sanitize`（只留 `[a-z0-9-_]`）。

### 3.3 `redraw-templates.service.ts`

```ts
export interface TemplateListItem { id: number; name: string; previews: string[] }
export interface TemplateDetail { id: number; name: string; body: string; previews: string[] }

export function listTemplates(): TemplateListItem[];      // 不回 body
export function getTemplate(id: number): TemplateDetail;  // 不存在 → TEMPLATE_NOT_FOUND
export function createTemplate(input: unknown): TemplateDetail;
export function updateTemplate(id: number, input: unknown): TemplateDetail;
export function deleteTemplate(id: number): void;         // 连示例图文件一起删
export function addPreview(id: number, dataUrl: unknown): TemplateDetail;
export function removePreview(id: number, previewId: number): TemplateDetail;
```

校验规则：

| 字段 | 规则 | 错误码 |
| --- | --- | --- |
| `name` | trim 后 1–60 字 | `EMPTY_TEMPLATE_NAME` / `TEMPLATE_NAME_TOO_LONG` |
| `body` | trim 后 1–10000 字 | `EMPTY_TEMPLATE_BODY` / `PROMPT_TOO_LONG` |
| 模板总数 | ≤ 200 | `TEMPLATE_LIMIT_REACHED` |
| 示例图 | 每模板 ≤ 3 张、单张 ≤ 5MB、jpg/png/webp | `PREVIEW_LIMIT_REACHED` / `PREVIEW_TOO_LARGE` / `INVALID_PREVIEW_IMAGE` |

`listTemplates()` 的 SQL 用一次查询 + 内存分组，避免 N+1：

```ts
const rows = db.prepare(`
  SELECT t.id, t.name, p.id AS pid, p.path, p.seq
  FROM redraw_templates t
  LEFT JOIN redraw_template_previews p ON p.template_id = t.id
  ORDER BY t.id DESC, p.seq ASC
`).all();
```

### 3.4 `redraw.service.ts`

```ts
export interface RedrawResult {
  history_id: number | null;
  source_url: string;
  result_url: string;
  prompt: string;
}

export async function redraw(input: unknown): Promise<RedrawResult>;
```

编排顺序（顺序很重要）：

```text
1. 校验入参（image / prompt）
2. 读模型配置（缺 base_url/api_key/image_model → MODEL_NOT_CONFIGURED）
3. 调 generateImageWithEdits（原图 + 最终 prompt）
4. 并发落盘原图与结果图（各自 saveDataUrlImage）
5. 写历史（try/catch 包裹，失败只记日志）
6. enforceCapacity()（失败只记日志）
7. 返回 URL + history_id
```

三点约束：

- **步骤 5、6 绝不阻断返回**。用户等了 60s，不能因为磁盘满就拿不到图。
- 落盘失败（步骤 4）则整体失败，返回 `IMAGE_STORAGE_FAILED`（502）——因为没有文件就没有可访问的 URL。
- 原图与结果图分开命名（`-src` / `-out` 后缀），便于排查。

### 3.5 `redraw-prompt-optimize.service.ts`

```ts
const OPTIMIZE_TIMEOUT_MS = 180_000;
const PROMPT_MAX_LENGTH = 10_000;

export async function optimizeRedrawPrompt(input: unknown): Promise<string>;
```

- 输入**全量**，不截断（已确认决策）。
- 直接复用 `chatCompletion(config, messages, { timeoutMs: OPTIMIZE_TIMEOUT_MS })`，system prompt 用附录 A.1 原文。
- 上游返回的 context 超限错误，`llm-client` 目前会包成 `UPSTREAM_ERROR` 且 message 带 `HTTP 400：...`。需在此 service 捕获并识别关键字：

```ts
const CONTEXT_HINTS = /context[_ ]length|maximum context|too many tokens|prompt is too long/i;
if (err instanceof ApiError && CONTEXT_HINTS.test(err.message)) {
  throw new ApiError(400, 'PROMPT_OPTIMIZE_TOO_LONG',
    '提示词过长，超出模型上下文限制，请分段优化或减少篇幅');
}
```

> 不改 `llm-client.ts`：它是点评/提示词优化共用组件，改动面太大。在调用方做语义映射更安全。

- 输出回填前的长度判断放在前端（见 5.6），后端不做二次截断。

### 3.6 输入校验矩阵（统一在 service 首行执行）

| 入参 | 规则 | 错误码 |
| --- | --- | --- |
| `image` | data URL（jpeg/png/webp）、载荷非空、解码后 ≤8MB | `INVALID_IMAGE` / `IMAGE_TOO_LARGE` |
| `prompt` | string、trim 后 1–10000 字 | `EMPTY_PROMPT` / `PROMPT_TOO_LONG` |
| `template_id`（可选） | 正整数且存在 | `TEMPLATE_NOT_FOUND` |

**不信任前端**：`prompt` 一律重新 trim 与计长；`image` 一律重新解析 base64 与大小。photo-enhance 的 `validatePhotoOptimizeInput` 是现成范式，按同一风格实现。

---

## 4. 后端路由

### 4.1 路由清单

`routes/redraw.routes.ts`（新增，公开，无鉴权）：

```text
GET    /api/redraw/templates
GET    /api/redraw/templates/:id
POST   /api/redraw/templates
PATCH  /api/redraw/templates/:id
DELETE /api/redraw/templates/:id
POST   /api/redraw/templates/:id/previews
DELETE /api/redraw/templates/:id/previews/:previewId

GET    /api/redraw/history?page=&size=
GET    /api/redraw/history/:id
DELETE /api/redraw/history/:id
DELETE /api/redraw/history

GET    /api/redraw/files/:kind/:name      kind ∈ previews | history
```

`routes/ai.ts`（新增，必须放在通用 `/api/ai/:task` **之前**）：

```text
POST   /api/ai/image-redraw
POST   /api/ai/redraw-prompt-optimize
```

> Express 4 的 async 路由必须 `try { } catch (err) { next(err) }`，沿用现有写法。

### 4.2 `app.ts` 改动

```ts
// 必须放在全局 express.json() 之前
app.use('/api/ai/image-redraw', express.json({ limit: '12mb' }));
app.use('/api/redraw/templates', express.json({ limit: '12mb' })); // 示例图上传走该前缀
app.use(express.json());

app.use('/static', express.static(ASSETS_ROOT));
app.use(healthRouter, toolsRouter, adminRouter, redrawRouter, aiRouter);
```

尺寸核算：8MB 图 → base64 约 10.7MB，加 10000 字 prompt（约 30KB）与 JSON 外壳 ≈ 10.8MB，`12mb` 足够。

### 4.3 文件读取路由

```ts
redrawRouter.get('/api/redraw/files/:kind/:name', (req, res, next) => {
  const { kind, name } = req.params;
  if (kind !== 'previews' && kind !== 'history') throw new ApiError(404, 'FILE_NOT_FOUND', '文件不存在');
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new ApiError(404, 'FILE_NOT_FOUND', '文件不存在');
  const abs = resolveDataPath(`redraw/${kind}/${name}`);
  if (!fs.existsSync(abs)) throw new ApiError(404, 'FILE_NOT_FOUND', '文件不存在');
  res.type(path.extname(abs));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 文件名含随机串，可长缓存
  res.sendFile(abs);
});
```

不带 `immutable` 也不是不行，但文件内容一次写定、名字唯一，长缓存能显著减少历史列表的重复加载。

---

## 5. 前端

### 5.1 注册工具

| 文件 | 改动 |
| --- | --- |
| `db/seed.ts` | 在 `TOOL_SEEDS` 中 `photo-enhance` 之后插入一条；并给 `insertStmt` 补 `sort_order` 幂等同步 |
| `router/index.ts` | 在 `tool/:id` 之前加 `tools/image-redraw` → `ImageRedrawView.vue` |
| `ToolIcon.vue` | 无需改动（复用已登记的 `image`） |
| `HomeView.vue` | 无需改动（分类硬编码 3 类不变，网格 `auto-fill` 自适应） |

**`sort_order` 的坑**：现有 seed 只用 `index + 1` 插入，且只同步 `status / icon / name`。若把新工具插在数组中间，会让新工具拿到 `sort_order = 3`，与已存在的 `gear-params`（sort_order 3）撞号，`ORDER BY sort_order` 结果不稳定。两种解法：

- **方案 A（推荐）**：seed 增加 `UPDATE tools SET sort_order = ? WHERE id = ? AND sort_order <> ?`，与现有 status/icon/name 同步风格一致，顺带修正历史撞号。
- 方案 B：新工具追加到数组末尾（sort_order 11），接受它排在「摄影」分组最后。

选 A，改动仅 3 行。

### 5.2 页面结构 `views/ImageRedrawView.vue`

```text
┌─────────────────────────────────────────────────────────┐
│ 页头：影像 AI 重绘 · 模板驱动创意重绘                      │
├──────────────────┬──────────────────────────────────────┤
│ 左：上传区        │ 右：提示词工作区                       │
│  ImageUploader   │  · 提示词 textarea（字数 x/10000）      │
│  · 拖拽/点击     │  · [选择模板] [AI 优化] [清空]          │
│  · 预览/替换/移除 │  · 「修改仅本次生效」提示                │
│  · 8MB/格式校验  │  · [开始重绘]（空 prompt/无图则禁用）    │
├──────────────────┴──────────────────────────────────────┤
│ 进行中：RedrawProgress（4 段 + 已用秒数）                  │
├─────────────────────────────────────────────────────────┤
│ 结果：原图 / 结果图对比 · 下载 · 重新生成 · 免责声明        │
├─────────────────────────────────────────────────────────┤
│ 历史：RedrawHistoryPanel（分页 20 条）                    │
└─────────────────────────────────────────────────────────┘
```

### 5.3 组件拆分

| 组件 | 职责 | 说明 |
| --- | --- | --- |
| `ImageUploader.vue` | 拖拽/点击上传、校验、预览、替换、移除 | **新建，仅本页使用；不动 photo-enhance / photo-review** |
| `TemplatePickerDialog.vue` | 模板弹窗：卡片、名称检索、示例图放大、追加 | `el-dialog` + `el-image` |
| `RedrawProgress.vue` | 4 段进度 + 秒数 + 60s 安抚文案 | 纯展示，接收 `elapsed` 与 `stage` |
| `RedrawHistoryPanel.vue` | 历史列表、详情、删除、清空 | `el-image` 懒加载 |

关于「抽共享组件」：评审里建议抽 `ImageUploader` 给三个页面共用，但**直接改两个已验收页面属于额外回归风险**。本次只新建组件给新页面用，旧页面保持原样，后续单独重构。这是一个有意识的让步，不是遗漏。

### 5.4 状态机

```ts
type Phase = 'idle' | 'generating' | 'done' | 'error';
```

- `idle → generating`：提交前校验通过。
- `generating` 期间：禁用上传、替换、模板按钮、优化按钮、提交按钮；`RedrawProgress` 显示。
- `done`：展示结果；`error`：展示分类错误 + 保留全部输入，允许再次提交。
- 失败不写历史，也不清空输入。

### 5.5 进度实现

```ts
const STAGES = [
  { at: 0,   title: '正在读懂你的创意', desc: '梳理画面主体与风格' },
  { at: 10,  title: '正在铺陈画面',     desc: '构图、光线就位中' },
  { at: 45,  title: '正在打磨光影与细节', desc: '质感与色彩细化中' },
  { at: 100, title: '即将完成',         desc: '复杂画面会多花一点时间' },
] as const;
```

- `setInterval(1s)` 累加 `elapsed`，`stageIndex` 只增不减（`while (next.at <= elapsed) i++`）。
- `elapsed >= 60` 时追加安抚行："图像生成需要一点耐心，请勿关闭页面"。
- **不渲染百分比**，只渲染阶段名 + `已等待 42s`。
- `onUnmounted` 清 `setInterval`；请求结束（成功/失败/超时）也清。
- `prefers-reduced-motion` 下关闭进度条动画（保留文字与秒数）。

### 5.6 追加逻辑

```ts
const PROMPT_MAX = 10_000;

function appendTemplate(current: string, tplBody: string) {
  const body = tplBody.trim();
  if (!current.trim()) return { ok: true, text: body, mode: 'fill' as const };
  if (current.includes(body)) return { ok: false, reason: 'duplicate' as const };
  const next = `${current.trimEnd()}\n\n${body}`;
  if (next.length > PROMPT_MAX) {
    return { ok: false, reason: 'overflow' as const, remain: PROMPT_MAX - current.trimEnd().length - 2 };
  }
  return { ok: true, text: next, mode: 'append' as const };
}
```

配套交互：

- 追加成功 → toast「已追加到末尾」+「撤销」按钮，撤销恢复追加前全文（只保留最近一次）。
- `duplicate` → 「该模板已在提示词中」。
- `overflow` → 「剩余可输入 N 字，已取消本次追加」，不改动正文。
- 弹窗卡片显示模板字数，避免用户选一个 9000 字的模板才发现加不进去。

### 5.7 接口层 `api/redraw.ts`

```ts
export interface TemplateListItem { id: number; name: string; previews: string[] }
export interface RedrawResult { history_id: number | null; source_url: string; result_url: string; prompt: string }

export const listTemplates = () => http.get('/redraw/templates').then(r => r.data.data);
export const getTemplate = (id: number) => http.get(`/redraw/templates/${id}`).then(r => r.data.data);
export const createTemplate = (p: { name: string; body: string }) => ...;
export const updateTemplate = (id: number, p: Partial<{ name: string; body: string }>) => ...;
export const deleteTemplate = (id: number) => ...;
export const addPreview = (id: number, image: string) => ...;
export const removePreview = (id: number, previewId: number) => ...;

export const imageRedraw = (p: { image: string; prompt: string }, timeoutMs = 320_000) =>
  http.post('/ai/image-redraw', p, { timeout: timeoutMs }).then(r => r.data.data);

export const optimizeRedrawPrompt = (prompt: string) =>
  http.post('/ai/redraw-prompt-optimize', { prompt }, { timeout: 180_000 }).then(r => r.data.data);

export const listHistory = (page: number, size = 20) => ...;
```

超时设定：重绘前端 320s（后端 `images/edits` 150s + 落盘），优化 180s。两者都必须在 `http.ts` 默认 15s 之外单独覆盖，否则必定超时。

---

## 6. 关键实现细节

### 6.1 历史写入失败不阻断

```ts
let historyId: number | null = null;
try {
  historyId = saveHistory({ sourcePath, resultPath, prompt, templateId, sourceBytes, resultBytes });
  enforceCapacity();
} catch (err) {
  console.error('[image-redraw] 历史写入失败', err instanceof Error ? err.message : err);
}
return { history_id: historyId, source_url, result_url, prompt };
```

### 6.2 落盘失败必须阻断

图片没落盘就没有可访问的 URL，返回 502 `IMAGE_STORAGE_FAILED`，前端提示「图片保存失败，请检查磁盘空间」。

### 6.3 重绘提示词不做二次改写

直接使用用户最终文本作为 `prompt` 传给 `images/edits`，后端**不追加**任何系统前缀。若未来要加统一约束，应在模板层或 UI 层表达，避免"用户看到的"和"实际提交的"不一致。

### 6.4 重复提交

前端在 `generating` 期间禁用按钮。后端不加幂等键——本地单机、单用户，且每次重绘本就该产生独立结果。若后续需要防抖，再加请求指纹表，当前不做。

### 6.5 日志

沿用现有规范，只记 `[image-redraw] 阶段=xxx 耗时=xxxms code=xxx`。禁止打印完整 prompt、完整 data URL、图片字节。

---

## 7. 错误码映射

| 错误码 | HTTP | 前端文案方向 |
| --- | --- | --- |
| `INVALID_IMAGE` | 400 | 图片格式不支持，请上传 jpg/png/webp |
| `IMAGE_TOO_LARGE` | 400 | 图片过大（最大 8MB） |
| `EMPTY_PROMPT` | 400 | 请先输入或选择提示词 |
| `PROMPT_TOO_LONG` | 400 | 提示词超出 10000 字 |
| `EMPTY_TEMPLATE_NAME` / `TEMPLATE_NAME_TOO_LONG` | 400 | 请填写模板名称（≤60 字） |
| `EMPTY_TEMPLATE_BODY` | 400 | 模板正文不能为空 |
| `TEMPLATE_NOT_FOUND` | 404 | 模板不存在或已删除 |
| `TEMPLATE_LIMIT_REACHED` | 400 | 模板数量已达上限（200），请先删除不用的模板 |
| `PREVIEW_LIMIT_REACHED` | 400 | 每个模板最多 3 张示例图 |
| `INVALID_PREVIEW_IMAGE` / `PREVIEW_TOO_LARGE` | 400 | 示例图格式/大小不符 |
| `HISTORY_NOT_FOUND` | 404 | 记录不存在 |
| `FILE_NOT_FOUND` | 404 | 图片不存在 |
| `INVALID_FILE_PATH` | 400 | 非法文件路径 |
| `IMAGE_STORAGE_FAILED` | 502 | 图片保存失败，请检查磁盘空间 |
| `PROMPT_OPTIMIZE_TOO_LONG` | 400 | 提示词超出模型上下文，请分段优化 |
| `PROMPT_OPTIMIZE_FAILED` | 502 | 优化失败，已保留原提示词 |
| `MODEL_NOT_CONFIGURED` | 400 | 模型服务尚未配置 |
| `UPSTREAM_*` / `IMAGE_DECODE_FAILED` / `IMAGE_GENERATION_FAILED` | 复用 | 沿用 photo-enhance 的文案 |

---

## 8. 实施顺序

按「后端可独立验收」的顺序推进，每步都能用 curl 验证，不必等前端。

| 步骤 | 内容 | 验收方式 |
| --- | --- | --- |
| 1 | 3 张表 + `file-store.ts` + seed 工具与 sort_order 同步 | 启动无报错；`GET /api/tools` 出现第 11 个工具；`data/redraw/` 自动创建 |
| 2 | 模板 service + 路由 | curl 建模板 → 传 3 张示例图 → 列表/详情/改/删；第 4 张返回 `PREVIEW_LIMIT_REACHED`；空正文返回 `EMPTY_TEMPLATE_BODY` |
| 3 | 重绘 service + 路由 | 真实调用一次：出图 → 落盘 → 返回 URL；断网/错误 key 验证错误码 |
| 4 | 历史 service + 路由 | 列表倒序分页；删除单条后文件消失；手动造 101 条验证自动清理 |
| 5 | 提示词优化 service + 路由 | 短文本正常返回；10000 字全文提交不截断；构造超上下文报错验证映射 |
| 6 | 前端页面 + 4 组件 + 接口层 | 手工走完整链路 |
| 7 | 联调验收 | 见第 9 节 |

---

## 9. 验收清单

### 9.1 构建与类型

```bash
cd server-node && npx tsc --noEmit -p tsconfig.json
cd frontend && pnpm build
```

### 9.2 功能

- [ ] 未上传图 → 提交禁用；上传 jpg/png/webp 预览正常；超 8MB 被拒。
- [ ] 空提示词 → 提交禁用；后端直接调也返回 `EMPTY_PROMPT`。
- [ ] 纯手输可出图。
- [ ] 手输后选模板 → 追加到末尾（空行分隔）；同模板二次选中不重复追加。
- [ ] 追加导致超 10000 字 → 拒绝且正文不变。
- [ ] 模板弹窗：名称检索、3 张缩略图、点击放大、空状态文案。
- [ ] 模板 CRUD 全通；删除后磁盘文件同步消失。
- [ ] 重绘成功：结果图可看、可下载、可重新生成。
- [ ] 进度：4 段推进不回退、显示秒数、60s 后出现安抚文案、切页不残留定时器。
- [ ] 历史：成功后出现；详情可对比原图/结果图；单条删除与清空都删文件。
- [ ] 历史写入失败（临时把 data 目录设为只读）时，结果图仍正常返回。

### 9.3 安全

- [ ] 前端网络请求中无 API key。
- [ ] 日志不含完整 prompt / 完整图片。
- [ ] 访问 `/api/redraw/files/history/../../.env` 返回 404，不能穿越读取。

---

## 10. 已知风险

| 风险 | 触发条件 | 处理 |
| --- | --- | --- |
| 上游 prompt 长度上限未知 | 10000 字提示词提交 | 真实联调时验证；超限给可读错误，不静默失败 |
| 长文本优化耗时长 | 接近 10000 字 | 后端 180s / 前端 180s；loading 禁用按钮 |
| 中转上下文不足 | 模型窗口小于 1.5 万 token | 映射为 `PROMPT_OPTIMIZE_TOO_LONG`，提示分段 |
| 历史占满磁盘 | 长期使用 | 100 条 / 2GB 双上限自动清理 |
| Docker 内绝对路径 | 容器 `/app/data` vs 本地 `server-node/data` | DB 只存相对路径，运行时用 `DATA_DIR` 拼接 |
| 无鉴权写接口 | 任何访问者可增删 | 本地单机接受；**禁止把 3001 暴露到公网** |

---

## 11. 实施记录（与方案的差异）

| 项 | 方案 | 实际 | 原因 |
| --- | --- | --- | --- |
| 示例图返回结构 | `previews: string[]` | `previews: { id, url }[]` | 删除示例图需要 previewId，光有 URL 无法定位记录 |
| `vite.config.ts` | 未列入改动 | 增加 `/api` 代理 | 图片以相对路径 `<img src="/api/redraw/files/...">` 引用，开发环境 5173 无 `/api` 代理会 404 |
| 优化路由入参 | 传 `prompt` 字符串 | 传 `req.body` | 首版传裸字符串导致服务恒判空；service 已同时兼容两种形态 |
| 模板名称字数标识 | — | 用自绘计数替代 `show-word-limit` | EP 的字数角标在深色弹窗里是浅色块，与主题冲突 |

验证结果：

- 真实重绘 30.5s 出图，结果图 2.5MB，落盘 + URL 回传 + 历史写入全部通过。
- 真实优化 3.5s 返回中文优化稿。
- 容量清理实测 106 条 → 100 条。
- 路径穿越 `..%2f..%2f.env` 返回 404。

## 附录 A：system prompt 常量位置

放在 `services/redraw-prompt-optimize.service.ts` 顶部，与 `photo-optimize.service.ts` 的 `ANALYSIS_SYSTEM_PROMPT` 保持同一书写风格。正文取 `docs/image-redraw-requirements-review.md` 附录 A.1 的最终版（长度随输入自适应、长输入保留段落结构逐段优化）。

## 附录 B：样式约定

- 用户端沿用深色电影风令牌（`style.css` 中的 CSS 变量），不引入新的颜色常量。
- 管理端无改动（本功能没有管理页）。
- 动画必须尊重 `prefers-reduced-motion`。
- LLM 返回文本若需渲染（提示词优化结果是纯文本），用 `white-space: pre-wrap` + `textContent`，不要走 `marked`，避免把提示词里的 `#`、`*` 渲染成 HTML。

## 12. 视觉层：背景画廊与工具图标（2026-10-27 追加）

### 12.1 背景画廊 `components/RedrawMural.vue`

把 14 张「原图 → 重绘」示例图作为页面背景，纵向切成 8 条画廊列（窄屏按断点减到 6/4/2 列），相邻列反向匀速漂移，形成持续流动的墙面。

- **无缝循环**：每列内容渲染两份（`.mural-run` × 2），位移 `-50%`。`.mural-run` 的 `padding-bottom` 必须等于列间距，否则半程位移会差一个 gap，出现肉眼可见的跳动。
- **亮度分层**：`.mural-veil`（顶部压暗 + 底部收口 + 全局轻压）→ `.mural-grain`（SVG 噪声）→ `.mural-spot`（跟随指针的暖光，仅 `pointer: fine` 生效）。正文区靠 `.glass` 面板自身保证可读，不靠把整面墙压黑。
- **性能红线**：不要在超大的动画层上挂 `filter` / `mask-image` / `scale()`。这三者叠加时（8 列 × 5 张）页面会重到浏览器截图接口都抓不稳；左右淡出改为 `.mural::after` 覆盖层，边缘露出用负偏移（`left/right: -48px`）解决，不用缩放。
- **素材规格**：`assets/redraw-mural/01..14.jpg`，440×587、quality 76，全量 0.63MB。原图 1367×1823、单张 250–510KB，直接铺会造成首屏 5.5MB。
- 滚动视差把位移限制在 ±40px 内（受负偏移余量约束），超出会露黑边。
- **速度**：`BASE_DURATION_S = 88`、`SPEED = 2.5`，单列周期 = `(88 + 偏移) / SPEED`（35–65s，即初版 2.5 倍速）。调速只改 `SPEED` 一个常量；调快后若觉得「跳」，先检查 `.mural-run` 的 `padding-bottom` 是否仍等于 gap。

### 12.2 工具图标 `components/IconRedraw.vue`

Element Plus 的 `Picture` 在 20px 卡片尺寸下笔画过稀，视觉上近似空框。改为自绘 SVG，构图是**画框在右上角开口，被一颗四角星芒冲出**：

- **缺口即语义**：框子右上角不闭合，缺口正好被星芒的下臂接住——「原图被改写」这件事靠一个缺口就说清了，比满框 + 贴边小星星更有叙事，小尺寸下视线也有落点。
- **实心块 + 描边混用**：框用 1.95 描边（与 EP 同族密度），山峦、落日、星芒全部实心 `currentColor`。20px 下细线会消失，实心剪影不会。
- **星芒用二次曲线做内凹弧**，不用直线星：直线星在 20px 下四条边会糊成一个菱形块，内凹弧能保住「星」的轮廓。
- 副星点放在左上 `(10.6, 2.7)`，与主星芒左臂（`x=12.8`）留 0.6 间隙，两者不粘连。
- 主星芒 `cy=5.7 / r=5.4`，顶臂落在 `y=0.3`，不会被 viewBox 切掉尖角（第一版用 `cy=5.3 / r=5.6`，尖端被裁平）。

- `ToolIcon.vue` 注册 `redraw`（`markRaw(IconRedraw)`），种子数据 `icon` 字段由 `image` 改为 `redraw`。
- `seed.ts` 的 `icon` 是幂等 UPDATE 同步的，改完必须重启后端才生效；DB 里已有的 `image` 不会因为前端加组件而自动变。
- 页头 56px chip 里加了一层暖光（`radial-gradient` 定位在 78% 16%，即星芒所在角），呼应图标而不改动图标本身；首页卡片保持与其他工具一致的平面 chip。
