<script setup lang="ts">
// 照片 AI 优化工具页（布局 A 引导工作台）：左栏上传 + 右栏场景/描述/提交，
// 单次 POST 后按时间预估推进四阶段，结果区展示原图/成图对比与结构化优化方向
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Camera, MagicStick } from '@element-plus/icons-vue';
import {
  photoOptimize,
  photoOptimizeRetry,
  PHOTO_OPTIMIZE_SCENES,
  PHOTO_OPTIMIZE_SCENE_LABELS,
  type PhotoAnalysis,
} from '@/api/ai';
import EmptyState from '@/components/EmptyState.vue';
import NotFoundState from '@/components/NotFoundState.vue';
import PhotoWall from '@/components/PhotoWall.vue';
import SubmitButton from '@/components/SubmitButton.vue';
import ToolPageHeader from '@/components/ToolPageHeader.vue';
import { useLongTask } from '@/composables/useLongTask';
import { useToolMeta } from '@/composables/useToolMeta';

/** 优化请求超时上限（与 api/ai.ts photoOptimize 默认 timeout 一致） */
const OPTIMIZE_TIMEOUT_S = 320;

/** 四阶段标签（顺序固定，索引与 stage=1..4 对应） */
const STAGES = ['分析原图', '整理优化方向', '生成优化图', '接收并处理结果'] as const;

/**
 * 各阶段起始秒数：后端为单次 POST（无 SSE 真实进度），只能按时间预估推进——
 * 时间预估，非后端真实进度。依据最坏链路「阶段一分析 ≈90s + 生图 ≈120s ≈210s」：
 * 0s 进入分析、15s 分析应已出方向、45s 进入生图窗口、150s 接近最坏返回时刻
 */
const STAGE_START_S = [0, 15, 45, 150];

/** directions 六字段的展示标签（空字符串项不渲染） */
const DIRECTION_LABELS: Array<{ key: keyof PhotoAnalysis['directions']; label: string }> = [
  { key: 'crop', label: '构图与裁剪' },
  { key: 'tone', label: '影调与色彩' },
  { key: 'brightness', label: '亮度与曝光' },
  { key: 'content', label: '画面内容增删' },
  { key: 'style', label: '整体风格' },
  { key: 'platform', label: '平台适配' },
];

/** 允许的图片类型与大小上限（与后端校验一致） */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 20;

/** 优化描述字数上限（与后端 NOTE_MAX_LENGTH 一致） */
const NOTE_MAX = 500;

const TOOL_ID = 'photo-enhance';

const router = useRouter();
const { tool, loading, notFound } = useToolMeta(() => TOOL_ID);

/* ===== 输入区状态 ===== */
const fileInput = ref<HTMLInputElement>();
const imageDataUrl = ref('');
const fileName = ref('');
const scene = ref<(typeof PHOTO_OPTIMIZE_SCENES)[number]>('general');
const note = ref('');
const submitting = ref(false);

/** 描述字数（trim 后计数，与后端口径一致；允许输入超限以触发红色/禁用） */
const noteCount = computed(() => note.value.trim().length);
const noteOver = computed(() => noteCount.value > NOTE_MAX);

/** 提交可用：有图 + 未在提交中 + 描述未超长 */
const canSubmit = computed(
  () => imageDataUrl.value !== '' && !submitting.value && !noteOver.value,
);

/* ===== 等待/结果/失败状态 ===== */
const {
  elapsed,
  stage,
  start: startWaiting,
  stop: stopWaiting,
} = useLongTask({
  timeoutS: OPTIMIZE_TIMEOUT_S,
  stages: STAGES.map((label, i) => ({ label, startS: STAGE_START_S[i] })),
});

const analysis = ref<PhotoAnalysis | null>(null);
const resultImage = ref('');
const errorInfo = ref<{ code: string; message: string } | null>(null);

/** 工作区阶段：等待 → 失败 → 成功 → 空态（互斥，error/done 由提交开始时重置） */
const phase = computed<'idle' | 'waiting' | 'error' | 'done'>(() => {
  if (submitting.value) return 'waiting';
  if (errorInfo.value) return 'error';
  if (resultImage.value) return 'done';
  return 'idle';
});

/** analysis 非空项（方向标签 + 文本），用于结果/失败区的结构化摘要 */
const directionEntries = computed(() => {
  const a = analysis.value;
  if (!a) return [];
  return DIRECTION_LABELS.map(({ key, label }) => ({ label, text: a.directions[key].trim() })).filter(
    (d) => d.text !== '',
  );
});

/** 选择/拖入图片：校验类型与大小后转 data URL 预览 */
function acceptFile(file: File | undefined) {
  if (submitting.value || !file) return;
  if (!ALLOWED_TYPES.includes(file.type)) {
    ElMessage.warning('仅支持 jpg / png / webp 图片');
    return;
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    ElMessage.warning(`图片不能超过 ${MAX_SIZE_MB}MB`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    // 换图即上一轮结果/错误/分析作废，避免新原图与旧成图错误配对
    resetOutcome();
    imageDataUrl.value = String(reader.result);
    fileName.value = file.name;
  };
  reader.readAsDataURL(file);
}

function onFileChange(e: Event) {
  acceptFile((e.target as HTMLInputElement).files?.[0]);
  if (fileInput.value) fileInput.value.value = '';
}

function onDrop(e: DragEvent) {
  acceptFile(e.dataTransfer?.files?.[0]);
}

function removeImage() {
  if (submitting.value) return;
  resetOutcome();
  imageDataUrl.value = '';
  fileName.value = '';
}

/** 清空上一轮结果态（结果图/分析/错误），换图与删图时调用 */
function resetOutcome() {
  resultImage.value = '';
  analysis.value = null;
  errorInfo.value = null;
}

/** 是否前端 axios 超时（无响应，code 为 ECONNABORTED） */
function isTimeoutError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ECONNABORTED';
}

/** 后端错误响应体（成功响应不经过此结构；data 携带可能已完成的分析） */
interface OptimizeErrorBody {
  code?: string;
  message?: string;
  data?: { analysis?: PhotoAnalysis | null } | null;
}

/** 提交优化（完整两阶段：分析 + 生图；成功/失败均保留原图、场景与描述，失败无自动重试） */
async function submit() {
  await runOptimize(false);
}

/**
 * 失败面板「手动重试」：持有 analysis → 走 /retry 端点仅重新生成（不再重复分析）；
 * 无 analysis（分析阶段失败/前端超时）→ 完整重新提交
 */
async function retry() {
  await runOptimize(analysis.value !== null);
}

/**
 * 执行优化：retryOnly=false 完整提交；retryOnly=true 携带已有 analysis 仅重发生图
 * 两种模式共用同一套等待/成功/失败状态处理
 */
async function runOptimize(retryOnly: boolean) {
  if (!canSubmit.value) return;
  const priorAnalysis = retryOnly ? analysis.value : null;
  submitting.value = true;
  // 完整提交时清空旧分析；仅重发生图时保留（等待期摘要面板继续展示）
  if (!priorAnalysis) analysis.value = null;
  resultImage.value = '';
  errorInfo.value = null;
  // 仅重发生图时分析已完成，阶段直接从「生成优化图」开始（简单方案：仍复用完整四阶段时间轴）
  startWaiting(priorAnalysis ? 3 : 1);
  try {
    const params = {
      image: imageDataUrl.value,
      scene: scene.value,
      note: note.value.trim() || undefined,
    };
    const res = priorAnalysis
      ? await photoOptimizeRetry({ ...params, analysis: priorAnalysis })
      : await photoOptimize(params);
    stage.value = STAGES.length;
    analysis.value = res.analysis;
    resultImage.value = res.result_image;
  } catch (err) {
    if (isTimeoutError(err)) {
      // 前端等待超时：关掉拦截器的通用 toast，弹窗说明具体原因，并落错误面板供手动重试
      ElMessage.closeAll();
      errorInfo.value = {
        code: 'TIMEOUT',
        message: `等待超过 ${OPTIMIZE_TIMEOUT_S} 秒未收到响应，可手动重试`,
      };
      ElMessageBox.alert(
        `本次优化超过 ${OPTIMIZE_TIMEOUT_S} 秒仍未完成。常见原因：分析或生图服务响应缓慢、网络波动、或照片文件过大（base64 传输耗时）。建议稍后重试，或换一张更小的照片。`,
        '优化超时',
        { confirmButtonText: '知道了', type: 'warning' },
      );
    } else {
      // HTTP 错误：通用 message 已由拦截器 toast；此处落面板展示错误码 + 支持携带的 analysis
      const body = (err as { response?: { data?: OptimizeErrorBody } } | null)?.response?.data;
      errorInfo.value = {
        code: body?.code ?? 'REQUEST_FAILED',
        message: body?.message ?? '请求失败，请稍后重试',
      };
      analysis.value = body?.data?.analysis ?? null;
    }
    console.error('[photo-optimize] 优化失败:', err);
  } finally {
    stopWaiting();
    submitting.value = false;
  }
}

/** 从 data URL 前缀提取图片扩展名（jpeg→jpg），提取失败回退 png */
function resultExt(): string {
  const m = /^data:image\/(jpeg|png|webp);base64/.exec(resultImage.value);
  if (!m) return 'png';
  return m[1] === 'jpeg' ? 'jpg' : m[1];
}

/** 生成图下载文件名：photo-optimize-YYYYMMDD-HHmm.<按实际 MIME 定扩展名> */
function downloadName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `photo-optimize-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${resultExt()}`;
}

function downloadResult() {
  if (!resultImage.value) return;
  const a = document.createElement('a');
  a.href = resultImage.value;
  a.download = downloadName();
  document.body.appendChild(a);
  a.click();
  a.remove();
}
</script>

<template>
  <PhotoWall :seed="20260922" />

  <div v-loading="loading" class="tool-page" @dragover.prevent @drop.prevent>
    <template v-if="tool">
      <ToolPageHeader
        :crumb="`TOOLS / ${tool.id.toUpperCase()}`"
        :icon="tool.icon"
        :title="tool.name"
        back-to="/"
        variant="wall"
      />

      <!-- 输入区：单页双栏（左上传 / 右场景+描述+提交） -->
      <div class="input-layout">
        <section class="panel upload-panel">
          <div
            v-if="!imageDataUrl"
            class="dropzone"
            tabindex="0"
            role="button"
            aria-label="上传照片"
            @click="fileInput?.click()"
            @keydown.enter="fileInput?.click()"
            @dragover.prevent
            @drop.prevent="onDrop"
          >
            <el-icon class="dz-icon" aria-hidden="true"><Camera /></el-icon>
            <p class="dz-title">点击或拖入照片</p>
            <p class="dz-desc">jpg / png / webp，不超过 {{ MAX_SIZE_MB }}MB，一次一张</p>
            <input
              ref="fileInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              @change="onFileChange"
            />
          </div>

          <div v-else class="preview">
            <img :src="imageDataUrl" alt="待优化照片" />
            <div class="preview-meta">
              <span class="preview-name" :title="fileName">{{ fileName }}</span>
              <button class="pill" :disabled="submitting" @click="removeImage">换一张</button>
            </div>
          </div>
        </section>

        <section class="panel config-panel">
          <div class="scene-field">
            <label class="field-label">优化场景</label>
            <div class="scene-group" role="radiogroup" aria-label="优化场景">
              <button
                v-for="key in PHOTO_OPTIMIZE_SCENES"
                :key="key"
                type="button"
                class="scene-chip"
                :class="{ active: scene === key }"
                role="radio"
                :aria-checked="scene === key"
                :disabled="submitting"
                @click="scene = key"
              >
                {{ PHOTO_OPTIMIZE_SCENE_LABELS[key] }}
              </button>
            </div>
          </div>

          <div class="note-field">
            <label class="field-label" for="note-input">
              照片描述<span class="note-optional">（可选）</span>
            </label>
            <textarea
              id="note-input"
              v-model="note"
              class="note-input"
              :class="{ over: noteOver }"
              rows="3"
              :disabled="submitting"
              placeholder="想突出什么主体？打算用在什么平台？有什么必须保留的细节？"
            ></textarea>
            <p class="note-count" :class="{ over: noteOver }">{{ noteCount }} / {{ NOTE_MAX }}</p>
          </div>

          <SubmitButton
            :loading="submitting"
            :disabled="!canSubmit"
            label="分析并优化"
            loading-label="优化中，通常 30–210 秒"
            @click="submit"
          />
        </section>
      </div>

      <!-- 工作区：空态 / 四阶段等待 / 失败头部 / 成功对比 -->
      <section class="panel work-panel">
        <div v-if="phase === 'idle'" class="work-empty">
          <EmptyState
            :icon="MagicStick"
            title="优化结果会出现在这里"
            desc="上传照片、选定场景后提交，先分析再重绘"
          />
        </div>

        <!-- 四阶段：单次 POST 无 SSE，按时间预估推进（时间预估，非后端真实进度）
             aria-live 只在地标阶段切换时播报，秒数对读屏隐藏，避免每秒刷屏 -->
        <div v-else-if="phase === 'waiting'" class="stage-area" role="status" aria-live="polite">
          <ol class="stages">
            <li
              v-for="(label, i) in STAGES"
              :key="label"
              class="stage"
              :class="{ done: stage > i + 1, active: stage === i + 1 }"
            >
              <span class="stage-dot">{{ stage > i + 1 ? '✓' : i + 1 }}</span>
              <span class="stage-name">{{ label }}</span>
            </li>
          </ol>
          <p class="stage-elapsed" aria-hidden="true">
            已等待 {{ elapsed }} 秒 · 超时上限 {{ OPTIMIZE_TIMEOUT_S }} 秒
          </p>
          <p class="stage-hint">阶段按时间预估推进，非后端真实进度</p>
        </div>

        <div v-else-if="phase === 'error'" class="error-area">
          <p class="err-code">{{ errorInfo?.code }}</p>
          <p class="err-title">优化失败</p>
          <p class="err-msg">{{ errorInfo?.message }}</p>
          <p v-if="analysis" class="err-partial">
            分析已完成，重试仅重新生成（保留已完成的分析，不再重复分析）
          </p>
          <p v-else class="err-partial">重试将重新执行完整优化（重新分析原图后再生成）</p>
          <button class="pill retry-btn" :disabled="!canSubmit" @click="retry">手动重试</button>
        </div>

        <template v-else-if="phase === 'done'">
          <div class="compare-block">
            <div class="compare">
              <figure class="compare-cell">
                <img :src="imageDataUrl" alt="原图" />
                <figcaption>原图</figcaption>
              </figure>
              <figure class="compare-cell result">
                <img :src="resultImage" alt="优化后" />
                <!-- 下载入口：生成图右上角悬浮，仅图标（名称走 aria-label / title） -->
                <button
                  class="download-btn"
                  type="button"
                  aria-label="下载生成图"
                  title="下载生成图"
                  @click="downloadResult"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3.5v11" />
                    <path d="m7.2 10.2 4.8 4.8 4.8-4.8" />
                    <path d="M4.5 20.5h15" />
                  </svg>
                </button>
                <figcaption>优化后</figcaption>
              </figure>
            </div>
            <p class="ai-disclaimer">
              以上优化图由 AI 重绘生成，可能改变人物、文字、物体边缘和背景细节，请以生成图为准核对关键信息。
            </p>
          </div>
        </template>
      </section>

      <!-- 结构化优化方向摘要：成功或「分析已完成」的失败均展示 -->
      <section v-if="analysis" class="panel analysis-panel">
        <p class="ap-title">优化方向摘要</p>
        <p class="ap-summary">{{ analysis.summary }}</p>

        <div v-if="directionEntries.length" class="ap-block">
          <p class="ap-label">执行方向</p>
          <div class="dir-list">
            <div v-for="d in directionEntries" :key="d.label" class="dir-item">
              <span class="dir-tag">{{ d.label }}</span>
              <span class="dir-text">{{ d.text }}</span>
            </div>
          </div>
        </div>

        <div v-if="analysis.preserve.length" class="ap-block">
          <p class="ap-label">必须保留</p>
          <div class="tag-list">
            <span v-for="(item, i) in analysis.preserve" :key="i" class="tag keep">{{ item }}</span>
          </div>
        </div>

        <div v-if="analysis.avoid.length" class="ap-block">
          <p class="ap-label">禁止出现</p>
          <div class="tag-list">
            <span v-for="(item, i) in analysis.avoid" :key="i" class="tag avoid">{{ item }}</span>
          </div>
        </div>
      </section>
    </template>

    <NotFoundState
      v-else-if="notFound"
      title="未找到该工具"
      desc="可能已被下线或禁用"
    >
      <button class="pill" @click="router.push('/')">返回首页</button>
    </NotFoundState>
  </div>
</template>

<style scoped>
.tool-page {
  position: relative;
  z-index: 1;
  min-height: calc(100vh - 64px);
  min-height: calc(100dvh - 64px);
  max-width: 1060px;
  margin: 0 auto;
  padding: clamp(16px, 2.667vh, 32px) clamp(20px, 4vw, 40px);
}

@media (prefers-reduced-motion: reduce) {
  .download-btn {
    transition: none;
  }

  .download-btn:active {
    transform: none;
  }
}

/* ===== 通用面板（与点评页卡片同语言）===== */
.panel {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--bg2);
  padding: 20px;
}

/* ===== 输入区：单页双栏 ===== */
.input-layout {
  display: grid;
  grid-template-columns: minmax(280px, 4fr) 7fr;
  gap: 22px;
  align-items: start;
  margin-bottom: 22px;
}

@media (max-width: 880px) {
  .input-layout {
    grid-template-columns: 1fr;
  }
}

.upload-panel {
  padding: 18px;
}

.dropzone {
  border: 1px dashed rgba(255, 255, 255, 0.22);
  border-radius: 12px;
  padding: 48px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.25s var(--ease), background 0.25s var(--ease);
}

.dropzone:hover {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.03);
}

/* 焦点环交给全局 :focus-visible，不再自己吞掉 outline */
.dropzone:focus-visible {
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.05);
}

.dz-icon {
  display: block;
  margin: 0 auto 10px;
  width: 30px;
  height: 30px;
  font-size: 30px;
  color: var(--strip);
}

.dz-title {
  margin: 0 0 6px;
  font-size: 15.5px;
  font-weight: 500;
  color: var(--ink);
}

.dz-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.preview img {
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  border-radius: 12px;
  background: #000;
}

.preview-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}

.preview-meta .pill {
  height: 34px;
  min-width: 0;
  padding: 0 16px;
  font-size: 13px;
}

.preview-meta .pill:disabled {
  background: rgba(255, 255, 255, 0.08);
  color: var(--muted);
  cursor: not-allowed;
  opacity: 1;
}

.preview-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--muted);
}

/* ===== 右栏：场景 / 描述 / 提交 ===== */
.config-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px;
}

.field-label {
  display: block;
  margin-bottom: 10px;
  font-size: 13.5px;
  color: var(--ink);
}

.note-optional {
  color: var(--muted);
  font-size: 12px;
}

/* 11 场景胶囊按钮组：全部可见、无任意平台输入框 */
.scene-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.scene-chip {
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  font-size: 13px;
  font-family: inherit;
  padding: 7px 15px;
  cursor: pointer;
  transition:
    border-color 0.2s var(--ease),
    background-color 0.2s var(--ease),
    color 0.2s var(--ease);
}

.scene-chip:hover:not(:disabled):not(.active) {
  border-color: rgba(255, 255, 255, 0.4);
  color: var(--ink);
}

/* 选中态：白底黑胶囊，与提交按钮同语言 */
.scene-chip.active {
  background: #ffffff;
  border-color: #ffffff;
  color: #050505;
  font-weight: 600;
}

.scene-chip:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.note-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--ink);
  font-size: 14px;
  line-height: 1.6;
  padding: 10px 12px;
  resize: vertical;
  font-family: inherit;
}

/* 只改边框，不吞掉全局焦点环 */
.note-input:focus {
  border-color: rgba(255, 255, 255, 0.4);
}

/* 超 500 字：描边与计数转红，提交同步禁用 */
.note-input.over {
  border-color: rgba(245, 108, 108, 0.65);
}

.note-count {
  margin: 0;
  text-align: right;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
}

.note-count.over {
  color: var(--danger);
}

/* ===== 工作区 ===== */
.work-panel {
  padding: 26px 28px;
  min-height: 220px;
  margin-bottom: 22px;
}

.work-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 170px;
  text-align: center;
}

/* ===== 四阶段步骤条（自绘，稳定只前进）===== */
.stage-area {
  padding: 18px 0 6px;
}

.stages {
  display: flex;
  list-style: none;
  margin: 0 0 22px;
  padding: 0;
}

.stage {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

/* 连接线：从本节点指向下一节点 */
.stage:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 15px;
  left: calc(50% + 20px);
  width: calc(100% - 40px);
  height: 1px;
  background: var(--rule);
}

.stage.done:not(:last-child)::after {
  background: rgba(159, 220, 174, 0.55);
}

.stage-dot {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--rule);
  background: rgba(255, 255, 255, 0.04);
  font-family: var(--mono);
  font-size: 13px;
  color: var(--muted);
  transition: border-color 0.3s var(--ease), background-color 0.3s var(--ease), color 0.3s var(--ease);
}

.stage-name {
  font-size: 13px;
  color: var(--muted);
}

/* 进行中：白描边 + 微光 */
.stage.active .stage-dot {
  border-color: #ffffff;
  color: var(--ink);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.08);
  animation: pulse 1.6s var(--ease) infinite;
}

.stage.active .stage-name {
  color: var(--ink);
}

/* 已完成：绿勾 */
.stage.done .stage-dot {
  background: rgba(159, 220, 174, 0.14);
  border-color: rgba(159, 220, 174, 0.55);
  color: var(--success);
}

.stage.done .stage-name {
  color: var(--success);
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.08);
  }

  50% {
    box-shadow: 0 0 0 8px rgba(255, 255, 255, 0.04);
  }
}

.stage-elapsed {
  margin: 0 0 4px;
  text-align: center;
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--ink);
}

.stage-hint {
  margin: 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--strip);
}

@media (max-width: 640px) {
  .stages {
    flex-direction: column;
    gap: 14px;
  }

  .stage {
    flex-direction: row;
    text-align: left;
    gap: 12px;
  }

  .stage:not(:last-child)::after {
    display: none;
  }
}

/* ===== 失败头部 ===== */
.error-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 14px 0;
}

.err-code {
  margin: 0;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.18em;
  color: var(--danger);
  border: 1px dashed rgba(245, 108, 108, 0.45);
  border-radius: 999px;
  padding: 3px 12px;
}

.err-title {
  margin: 6px 0 0;
  font-size: 18px;
  font-weight: 500;
  color: var(--ink);
}

.err-msg {
  margin: 0;
  font-size: 13.5px;
  color: var(--muted);
  max-width: 560px;
  word-break: break-word;
}

/* 失败面板重试说明：有 analysis 仅重发生图，无 analysis 完整重新提交 */
.err-partial {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--warning);
  border: 1px dashed rgba(230, 162, 60, 0.45);
  border-radius: 10px;
  padding: 8px 14px;
}

.retry-btn {
  margin-top: 10px;
  height: 38px;
  min-width: 0;
  padding: 0 22px;
  font-size: 13.5px;
  cursor: pointer;
}

/* ===== 成功对比：桌面双栏，窄屏上下堆叠；免责声明留在此区域内 ===== */
.compare-block {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 880px) {
  .compare {
    grid-template-columns: 1fr;
  }
}

.compare-cell {
  position: relative;
  margin: 0;
}

.compare-cell img {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  border-radius: 12px;
  background: #000;
  border: 1px solid var(--rule);
}

.compare-cell.result img {
  border-color: rgba(159, 220, 174, 0.4);
}

.compare-cell figcaption {
  margin-top: 8px;
  text-align: center;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--strip);
}

/* ===== 结构化优化方向摘要 ===== */
.analysis-panel {
  padding: 24px 28px;
  margin-bottom: 22px;
}

.ap-title {
  margin: 0 0 12px;
  font-size: 15.5px;
  font-weight: 600;
  color: var(--ink);
}

.ap-summary {
  margin: 0 0 18px;
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--ink);
}

.ap-block {
  margin-bottom: 16px;
}

.ap-block:last-child {
  margin-bottom: 0;
}

.ap-label {
  margin: 0 0 8px;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--strip);
}

.dir-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dir-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13.5px;
}

.dir-tag {
  flex: none;
  font-size: 12px;
  color: var(--ink);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  padding: 2px 11px;
  background: rgba(255, 255, 255, 0.05);
}

.dir-text {
  color: var(--muted);
  line-height: 1.7;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag {
  font-size: 12.5px;
  border-radius: 8px;
  padding: 4px 11px;
  line-height: 1.6;
}

.tag.keep {
  color: var(--success);
  border: 1px solid rgba(159, 220, 174, 0.4);
  background: rgba(159, 220, 174, 0.08);
}

.tag.avoid {
  color: var(--danger-soft);
  border: 1px solid rgba(245, 108, 108, 0.4);
  background: rgba(245, 108, 108, 0.08);
}

/* ===== 生成图下载：右上角悬浮图标按钮 ===== */
.download-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: rgba(8, 8, 8, 0.58);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  color: var(--ink);
  cursor: pointer;
  /* 常驻极轻投影：保证浅色/白底图上按钮边缘依然清晰 */
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.28),
    0 4px 12px rgba(0, 0, 0, 0.18);
  transition:
    background 0.25s var(--ease),
    border-color 0.25s var(--ease),
    color 0.25s var(--ease),
    box-shadow 0.25s var(--ease),
    transform 0.25s var(--ease);
}

.download-btn svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.download-btn:hover {
  background: rgba(255, 255, 255, 0.92);
  border-color: transparent;
  color: #050505;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.22),
    0 6px 16px rgba(0, 0, 0, 0.26);
}

.download-btn:active {
  transform: translateY(1px);
}

.download-btn:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.6);
  outline-offset: 2px;
}

/* ===== AI 重绘免责（置于原图 / 优化后区域块内） ===== */
.ai-disclaimer {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
}

/* ===== 入场动画 ===== */
@media (prefers-reduced-motion: no-preference) {
  .input-layout {
    animation: rise 0.8s 0.16s var(--ease) both;
  }
}
</style>
