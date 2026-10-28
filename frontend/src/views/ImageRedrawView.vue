<script setup lang="ts">
// 影像 AI 重绘页：左栏上传原图 + 右栏提示词工作区（手输 / 模板追加 / AI 优化），
// 单次 POST 后按时间预估推进四阶段，结果区展示原图与重绘结果的对比，底部为历史记录
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  createTemplate,
  imageRedraw,
  optimizeRedrawPrompt,
  type RedrawResult,
  type TemplateDetail,
} from '@/api/redraw';
import ImageUploader from '@/components/ImageUploader.vue';
import TemplatePickerDialog from '@/components/TemplatePickerDialog.vue';
import RedrawProgress from '@/components/RedrawProgress.vue';
import RedrawHistoryPanel from '@/components/RedrawHistoryPanel.vue';
import RedrawMural from '@/components/RedrawMural.vue';
import ToolIcon from '@/components/ToolIcon.vue';
import { useToolsStore } from '@/stores/tools';

/** 提示词字数上限（与后端 PROMPT_MAX_LENGTH、模板正文上限一致） */
const PROMPT_MAX = 10_000;

/** 重绘请求超时上限（与 api/redraw.ts 一致） */
const REDRAW_TIMEOUT_S = 320;

const TOOL_ID = 'image-redraw';

const router = useRouter();
const toolsStore = useToolsStore();
const loadingTools = ref(true);

onMounted(async () => {
  try {
    await toolsStore.fetchTools(true);
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loadingTools.value = false;
  }
});

const tool = computed(() => toolsStore.tools.find((t) => t.id === TOOL_ID));

/* ===== 输入区 ===== */
const imageDataUrl = ref('');
const fileName = ref('');
const prompt = ref('');
/** 提交时锁定的原图（结果区展示用，避免用户换图后与旧结果错配） */
const submittedImage = ref('');
/** 当前提示词来源的模板 id（仅作来源标记与提示，不回存模板） */
const selectedTemplateId = ref<number | null>(null);

const promptCount = computed(() => prompt.value.trim().length);
const promptOver = computed(() => promptCount.value > PROMPT_MAX);
const canSubmit = computed(
  () => imageDataUrl.value !== '' && promptCount.value > 0 && !promptOver.value && !submitting.value,
);

/** 追加 / 优化后的撤销快照（只保留最近一次，8 秒后自动失效） */
const undoSnapshot = ref<string | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

function setUndo(snapshot: string) {
  undoSnapshot.value = snapshot;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoSnapshot.value = null;
  }, 8000);
}

function undo() {
  if (undoSnapshot.value === null) return;
  prompt.value = undoSnapshot.value;
  undoSnapshot.value = null;
  clearTimeout(undoTimer);
  ElMessage.success('已撤销');
}

/* ===== 模板 ===== */
const pickerVisible = ref(false);

/**
 * 追加模板正文到现有提示词末尾（空行分隔）
 * 完全匹配时判定重复，超长时拒绝追加且不改动正文——静默截断会让用户以为内容已写入
 */
function applyTemplate(detail: TemplateDetail) {
  const body = detail.body.trim();
  const current = prompt.value;
  const before = current;

  if (!current.trim()) {
    prompt.value = body;
  } else if (current.includes(body)) {
    ElMessage.info('该模板已在提示词中');
    return;
  } else {
    const next = `${current.trimEnd()}\n\n${body}`;
    if (next.length > PROMPT_MAX) {
      const remain = PROMPT_MAX - current.trimEnd().length - 2;
      ElMessage.warning(`剩余可输入 ${remain > 0 ? remain : 0} 字，已取消本次追加`);
      return;
    }
    prompt.value = next;
  }

  selectedTemplateId.value = detail.id;
  setUndo(before);
  ElMessage.success(current.trim() ? '已追加到末尾' : '已填入模板正文');
}

/* ===== 提示词优化 ===== */
const optimizing = ref(false);

async function optimizePromptText() {
  const text = prompt.value.trim();
  if (!text) {
    ElMessage.warning('请先输入或选择提示词');
    return;
  }
  if (optimizing.value || submitting.value) return;
  optimizing.value = true;
  const before = prompt.value;
  try {
    const result = await optimizeRedrawPrompt(text);
    if (result.length > PROMPT_MAX) {
      // 回填会立刻超限，用户一点提交就被拒；保留原文更安全
      ElMessage.warning(`优化结果 ${result.length} 字，超过 ${PROMPT_MAX} 字上限，已保留原提示词`);
      return;
    }
    prompt.value = result;
    setUndo(before);
    ElMessage.success('已优化，可继续手动调整');
  } catch {
    // 错误提示已由 axios 拦截器统一处理（后端会保留原提示词）
  } finally {
    optimizing.value = false;
  }
}

/** 把当前提示词存为模板（示例图需在模板管理中补充） */
async function saveAsTemplate() {
  const body = prompt.value.trim();
  if (!body) {
    ElMessage.warning('提示词为空，无法保存为模板');
    return;
  }
  let name = '';
  try {
    const result = await ElMessageBox.prompt('给这个提示词起个名字（最多 60 字）', '存为模板', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：赛博朋克夜景',
      inputValidator: (value: string) => {
        const text = (value ?? '').trim();
        if (!text) return '请填写模板名称';
        if (text.length > 60) return '模板名称最多 60 字';
        return true;
      },
    });
    name = result.value.trim();
  } catch {
    return;
  }

  try {
    const detail = await createTemplate({ name, body });
    selectedTemplateId.value = detail.id;
    ElMessage.success('已存为模板，可在模板管理中补充示例图');
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  }
}

function clearPrompt() {
  if (!prompt.value) return;
  setUndo(prompt.value);
  prompt.value = '';
  selectedTemplateId.value = null;
}

/* ===== 提交 / 进度 / 结果 ===== */
const submitting = ref(false);
const elapsed = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

const result = ref<RedrawResult | null>(null);
const errorInfo = ref<{ code: string; message: string } | null>(null);

/** 工作区阶段：空态 / 等待 / 失败 / 成功（互斥） */
const phase = computed<'idle' | 'waiting' | 'error' | 'done'>(() => {
  if (submitting.value) return 'waiting';
  if (errorInfo.value) return 'error';
  if (result.value) return 'done';
  return 'idle';
});

/** 历史列表刷新信号：每次生成成功 +1 */
const historyKey = ref(0);

function startWaiting() {
  stopWaiting();
  elapsed.value = 0;
  elapsedTimer = setInterval(() => {
    elapsed.value += 1;
  }, 1000);
}

function stopWaiting() {
  clearInterval(elapsedTimer);
  elapsedTimer = undefined;
}

onUnmounted(() => {
  stopWaiting();
  clearTimeout(undoTimer);
});

function isTimeoutError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ECONNABORTED';
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  result.value = null;
  errorInfo.value = null;
  submittedImage.value = imageDataUrl.value;
  startWaiting();

  try {
    const data = await imageRedraw({
      image: imageDataUrl.value,
      prompt: prompt.value.trim(),
      template_id: selectedTemplateId.value,
    });
    result.value = data;
    if (data.history_id !== null) historyKey.value += 1;
  } catch (err) {
    if (isTimeoutError(err)) {
      ElMessage.closeAll();
      errorInfo.value = {
        code: 'TIMEOUT',
        message: `等待超过 ${REDRAW_TIMEOUT_S} 秒未收到响应，可重试；已生成的结果可能仍会写入历史记录`,
      };
    } else {
      const body = (err as { response?: { data?: { code?: string; message?: string } } } | null)
        ?.response?.data;
      errorInfo.value = {
        code: body?.code ?? 'REQUEST_FAILED',
        message: body?.message ?? '请求失败，请稍后重试',
      };
    }
  } finally {
    stopWaiting();
    submitting.value = false;
  }
}

/** 用同一张图与同一段提示词再生成一次（模板来源不重复计入） */
async function regenerate() {
  if (submitting.value) return;
  await submit();
}

/** 结果下载：同源 URL + download 属性，浏览器直接落盘 */
function downloadResult() {
  const data = result.value;
  if (!data) return;
  const link = document.createElement('a');
  link.href = data.result_url;
  link.download = `redraw-${data.history_id ?? Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** 历史「用此提示词」：直接覆盖当前提示词，可撤销 */
function reuseFromHistory(text: string) {
  if (submitting.value) return;
  setUndo(prompt.value);
  prompt.value = text;
  selectedTemplateId.value = null;
  ElMessage.success('已填入提示词');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<template>
  <div class="redraw-shell">
    <!-- 背景画廊：示例图纵向漂移 + 中心暗幕，正文以玻璃面板浮在其上 -->
    <RedrawMural />

    <div v-loading="loadingTools" class="tool-page">
      <template v-if="tool">
        <p class="crumb"><span class="crumb-rule"></span>TOOLS / {{ tool.id.toUpperCase() }}</p>

        <header class="tool-header">
          <span class="tool-icon"><ToolIcon :name="tool.icon" /></span>
          <div class="title-wrap">
            <h2 class="tool-title">{{ tool.name }}</h2>
            <p class="tool-sub">模板驱动的创意重绘 · 保留原图内容，重塑画面风格</p>
          </div>
          <button class="pill back-btn" @click="router.push('/')">← 返回工具箱</button>
        </header>

        <!-- 输入区：左上传 / 右提示词工作区 -->
        <div class="input-layout">
          <section class="panel glass upload-panel">
            <div class="panel-head">
              <span class="panel-label">原图</span>
              <span class="panel-hint">必填</span>
            </div>
            <ImageUploader
              v-model="imageDataUrl"
              v-model:file-name="fileName"
              :disabled="submitting"
            />
          </section>

          <section class="panel glass prompt-panel">
            <div class="panel-head">
              <span class="panel-label">提示词</span>
              <span class="panel-hint" :class="{ over: promptOver }">
                {{ promptCount }} / {{ PROMPT_MAX }}
              </span>
            </div>

            <textarea
              v-model="prompt"
              class="prompt-input"
              :disabled="submitting"
              placeholder="描述你想要的画面：主体、环境、构图、光线、色彩、材质、风格…&#10;也可以先选择模板，会把模板正文追加到末尾。"
              spellcheck="false"
            ></textarea>

            <p v-if="selectedTemplateId !== null" class="edit-note">
              当前正文含模板内容，修改仅本次生效，不会保存回模板。
              <button class="link-btn" type="button" @click="saveAsTemplate">存为新模板</button>
            </p>

            <div class="prompt-tools">
              <button class="mini-btn" type="button" :disabled="submitting" @click="pickerVisible = true">
                选择模板
              </button>
              <button
                class="mini-btn"
                type="button"
                :disabled="submitting || optimizing || promptCount === 0"
                @click="optimizePromptText"
              >
                {{ optimizing ? '优化中…' : 'AI 优化' }}
              </button>
              <button class="mini-btn" type="button" :disabled="submitting" @click="saveAsTemplate">
                存为模板
              </button>
              <button
                class="mini-btn ghost"
                type="button"
                :disabled="submitting || promptCount === 0"
                @click="clearPrompt"
              >
                清空
              </button>
            </div>

            <p v-if="undoSnapshot !== null" class="undo-bar">
              已更新提示词
              <button class="link-btn" type="button" @click="undo">撤销</button>
            </p>

            <div class="submit-row">
              <button class="pill submit-btn" type="button" :disabled="!canSubmit" @click="submit">
                {{ submitting ? '生成中…' : '开始重绘' }}
              </button>
              <span v-if="!imageDataUrl" class="submit-hint">请先上传原图</span>
              <span v-else-if="promptCount === 0" class="submit-hint">请先输入或选择提示词</span>
              <span v-else-if="promptOver" class="submit-hint over">
                提示词超出 {{ PROMPT_MAX }} 字，请精简
              </span>
            </div>
          </section>
        </div>

        <!-- 进度 / 结果 / 失败 -->
        <RedrawProgress v-if="phase === 'waiting'" :elapsed="elapsed" class="progress-block" />

        <section v-else-if="phase === 'done' && result" class="panel glass result-panel">
          <div class="panel-head">
            <span class="panel-label">重绘结果</span>
            <span class="panel-hint">{{ result.history_id === null ? '未写入历史' : '已存入历史' }}</span>
          </div>

          <div class="compare">
            <figure class="shot">
              <img :src="submittedImage" alt="原图" />
              <figcaption>原图</figcaption>
            </figure>
            <figure class="shot">
              <img :src="result.result_url" alt="重绘结果" />
              <figcaption>重绘结果</figcaption>
            </figure>
          </div>

          <p class="result-prompt">{{ result.prompt }}</p>

          <div class="result-actions">
            <button class="pill" type="button" :disabled="submitting" @click="regenerate">重新生成</button>
            <button class="mini-btn" type="button" @click="downloadResult">下载图片</button>
          </div>

          <p class="disclaimer">
            重绘结果由 AI 生成，可能与原图存在细节差异；含人脸、商标或文字的图片请自行确认使用合规。
          </p>
        </section>

        <section v-else-if="phase === 'error' && errorInfo" class="panel glass error-panel">
          <div class="panel-head">
            <span class="panel-label">生成失败</span>
            <span class="panel-hint mono">{{ errorInfo.code }}</span>
          </div>
          <p class="error-msg">{{ errorInfo.message }}</p>
          <p class="error-tip">原图与提示词已保留，可直接重试。</p>
          <button class="pill" type="button" @click="submit">重试</button>
        </section>

        <RedrawHistoryPanel :refresh-key="historyKey" @reuse="reuseFromHistory" />
      </template>
    </div>

    <TemplatePickerDialog v-model="pickerVisible" @select="applyTemplate" />
  </div>
</template>

<style scoped>
.redraw-shell {
  position: relative;
}

.tool-page {
  position: relative;
  z-index: 2;
  min-height: calc(100vh - 64px);
  max-width: 1060px;
  margin: 0 auto;
  padding: clamp(16px, 2.667vh, 32px) clamp(20px, 4vw, 40px);
}

.crumb {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 26px;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(250, 250, 250, 0.74);
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 2px 14px rgba(0, 0, 0, 0.75);
}

/* 眉题前的细导线：给标题区一个入口，避免文字直接浮在画面上 */
.crumb-rule {
  width: 30px;
  height: 1px;
  flex: none;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45));
}

.tool-header {
  display: flex;
  align-items: center;
  gap: clamp(16px, 2vw, 22px);
  margin-bottom: clamp(26px, 4vh, 40px);
}

.tool-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  /* 右上角一点暖光，呼应图标那颗星芒，让 chip 不像一块死玻璃 */
  background:
    radial-gradient(120% 120% at 78% 16%, rgba(255, 214, 168, 0.18), rgba(255, 214, 168, 0) 62%),
    linear-gradient(160deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 26px;
  color: var(--ink);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    0 12px 30px -14px rgba(0, 0, 0, 0.9);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}

.title-wrap {
  min-width: 0;
}

.tool-title {
  margin: 0;
  font-size: clamp(30px, 4.6vw, 46px);
  font-weight: 300;
  line-height: 1.15;
  letter-spacing: -0.005em;
  color: var(--ink);
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.5),
    0 10px 46px rgba(0, 0, 0, 0.9);
}

.tool-sub {
  margin: 9px 0 0;
  font-size: 12.5px;
  letter-spacing: 0.02em;
  color: rgba(250, 250, 250, 0.84);
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 2px 14px rgba(0, 0, 0, 0.8);
}

/* 次要动作：不用白胶囊，避免和主 CTA「开始重绘」抢视觉重量 */
.tool-header .back-btn {
  margin-left: auto;
  height: 34px;
  min-width: 0;
  padding: 0 16px;
  font-size: 12.5px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.18);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition:
    background 0.25s var(--ease),
    border-color 0.25s var(--ease);
}

.tool-header .back-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.3);
  opacity: 1;
}

/* 面板：玻璃底衬见全局 .glass，这里只管内距与定位 */
.panel {
  position: relative;
  padding: 20px;
}

.panel-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}

.panel-label {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--nav);
}

.panel-hint {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--strip);
}

.panel-hint.over {
  color: #f2b8b5;
}

.mono {
  font-family: var(--mono);
  letter-spacing: 0.08em;
}

.input-layout {
  display: grid;
  grid-template-columns: minmax(280px, 4fr) 7fr;
  gap: 26px;
  align-items: start;
  margin-bottom: 22px;
}

@media (max-width: 880px) {
  .input-layout {
    grid-template-columns: 1fr;
  }
}

/* 窄屏：图标与返回按钮都要收小，否则一行放不下大标题 */
@media (max-width: 560px) {
  .tool-header {
    gap: 12px;
  }

  .tool-icon {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    font-size: 22px;
  }

  .tool-header .back-btn {
    height: 32px;
    padding: 0 12px;
    font-size: 12px;
  }
}

/* 窄屏：图标与返回按钮都要收小，否则一行放不下大标题 */
@media (max-width: 560px) {
  .tool-header {
    gap: 12px;
  }

  .tool-icon {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    font-size: 22px;
  }

  .tool-header .back-btn {
    height: 32px;
    padding: 0 12px;
    font-size: 12px;
  }
}

.prompt-input {
  width: 100%;
  min-height: 232px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(4, 4, 5, 0.52);
  color: var(--ink);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.75;
  resize: vertical;
  outline: none;
  transition: border-color 0.25s var(--ease);
}

.prompt-input:focus {
  border-color: rgba(255, 255, 255, 0.34);
}

.prompt-input:disabled {
  opacity: 0.6;
}

.prompt-input::placeholder {
  color: #5c5c60;
}

.edit-note {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--strip);
}

.prompt-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.mini-btn {
  height: 32px;
  padding: 0 15px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.2s var(--ease);
}

.mini-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.mini-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mini-btn.ghost {
  border-color: transparent;
  color: var(--strip);
}

.link-btn {
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 12px;
  color: var(--ink);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.undo-bar {
  margin: 12px 0 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  color: var(--muted);
  display: flex;
  gap: 10px;
  align-items: center;
}

.submit-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 20px;
}

.submit-btn {
  height: 42px;
  min-width: 132px;
  padding: 0 26px;
  font-size: 14.5px;
}

.submit-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.submit-hint {
  font-size: 12px;
  color: var(--strip);
}

.submit-hint.over {
  color: #f2b8b5;
}

.progress-block {
  margin-bottom: 22px;
}

.result-panel,
.error-panel {
  margin-bottom: 22px;
}

.compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 720px) {
  .compare {
    grid-template-columns: 1fr;
  }
}

.shot {
  margin: 0;
}

.shot img {
  display: block;
  width: 100%;
  max-height: 460px;
  object-fit: contain;
  border-radius: 10px;
  background: #000;
  border: 1px solid var(--rule);
}

.shot figcaption {
  margin-top: 8px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--strip);
  text-align: center;
}

.result-prompt {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}

.result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.result-actions .pill {
  height: 40px;
  padding: 0 22px;
  font-size: 14px;
}

.result-actions .pill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.disclaimer {
  margin: 14px 0 0;
  font-size: 11.5px;
  color: #64646a;
}

.error-msg {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--ink);
}

.error-tip {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--strip);
}

.error-panel .pill {
  height: 38px;
  padding: 0 22px;
  font-size: 13.5px;
}

/* 入场：标题先落、两块面板随后，给首屏一个呼吸节奏 */
@media (prefers-reduced-motion: no-preference) {
  .tool-header {
    animation: rise 0.8s var(--ease) both;
  }

  .input-layout .panel {
    animation: rise 0.9s var(--ease) both;
    animation-delay: 0.06s;
  }

  .input-layout .panel:nth-child(2) {
    animation-delay: 0.12s;
  }
}

/* 减少动效偏好下退出平滑滚动 */
@media (prefers-reduced-motion: reduce) {
  .prompt-input {
    transition: none;
  }
}
</style>
