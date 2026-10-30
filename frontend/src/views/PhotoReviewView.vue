<script setup lang="ts">
// 照片点评工具页：上传单张照片 + 可选拍摄描述，提交后展示多模态 LLM 的 Markdown 点评
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Camera, Picture } from '@element-plus/icons-vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { reviewPhoto } from '@/api/ai';
import EmptyState from '@/components/EmptyState.vue';
import NotFoundState from '@/components/NotFoundState.vue';
import PhotoWall from '@/components/PhotoWall.vue';
import SubmitButton from '@/components/SubmitButton.vue';
import ToolPageHeader from '@/components/ToolPageHeader.vue';
import { useLongTask } from '@/composables/useLongTask';
import { useToolMeta } from '@/composables/useToolMeta';

/** 点评请求超时上限（与 api/ai.ts 单请求 timeout 一致） */
const REVIEW_TIMEOUT_S = 180;

/** 等待期轮播文案（点评生成通常 10-60 秒，轮播缓解焦虑） */
const FUN_STATUS = [
  '博主正在眯眼看图…',
  '构图鉴定中…',
  '光线分析中…',
  '毒辣措辞酝酿中…',
  '分数纠结中…',
];

const route = useRoute();
const { tool, loading, notFound } = useToolMeta(() =>
  String(route.params.id ?? 'photo-review'),
);

/** 等待态：秒数计时 + 文案轮播（与提示词优化页同节奏） */
const {
  elapsed,
  stageLabel,
  start: startWaiting,
  stop: stopWaiting,
} = useLongTask({
  timeoutS: REVIEW_TIMEOUT_S,
  stages: FUN_STATUS.map((label) => ({ label })),
  rotateMs: 2500,
});

/** 允许的图片类型与大小上限 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 20;

const fileInput = ref<HTMLInputElement>();
const imageDataUrl = ref('');
const fileName = ref('');
const note = ref('');
const submitting = ref(false);
const reviewHtml = ref('');

/** 拍摄描述字数（上限 500，与后端一致）；超限不再静默截断，改为红字提示 + 禁用提交 */
const NOTE_MAX = 500;
const noteCount = computed(() => note.value.trim().length);
const noteOver = computed(() => noteCount.value > NOTE_MAX);

/** 提交按钮可用态 */
const canSubmit = computed(
  () => imageDataUrl.value !== '' && !noteOver.value && !submitting.value,
);

/**
 * marked 按 CommonMark 边界规则，「**加粗。**紧跟中文」不渲染成 strong（LLM 常见输出），
 * 解析前统一把 **…** 预转为 <strong>，DOMPurify 净化兜底
 */
function normalizeBold(md: string): string {
  return md.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
}

/** 选择/拖入图片：校验类型与大小后转 data URL 预览 */
function acceptFile(file: File | undefined) {
  if (!file) return;
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
    imageDataUrl.value = String(reader.result);
    fileName.value = file.name;
  };
  reader.readAsDataURL(file);
}

function onFileChange(e: Event) {
  acceptFile((e.target as HTMLInputElement).files?.[0]);
  // 允许重复选择同一文件
  if (fileInput.value) fileInput.value.value = '';
}

function onDrop(e: DragEvent) {
  acceptFile(e.dataTransfer?.files?.[0]);
}

function removeImage() {
  imageDataUrl.value = '';
  fileName.value = '';
}

/** 是否前端 axios 超时（无响应，code 为 ECONNABORTED） */
function isTimeoutError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ECONNABORTED';
}

/** 提交点评 */
async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  reviewHtml.value = '';
  startWaiting();
  try {
    const { review } = await reviewPhoto(imageDataUrl.value, note.value.trim() || undefined);
    // LLM 输出的 Markdown 先净化再渲染，防注入
    reviewHtml.value = DOMPurify.sanitize(
      marked.parse(normalizeBold(review), { async: false }),
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      // 前端等待超时：关掉拦截器的通用 toast，弹窗说明具体原因
      ElMessage.closeAll();
      ElMessageBox.alert(
        `本次点评超过 ${REVIEW_TIMEOUT_S} 秒仍未完成。常见原因：模型服务响应缓慢、网络波动、或照片文件过大（base64 传输耗时）。建议稍后重试，或换一张更小的照片。`,
        '点评超时',
        { confirmButtonText: '知道了', type: 'warning' },
      );
    }
    // 其余 HTTP 错误（含后端 504 LLM_TIMEOUT、502 上游错误）提示已由 axios 拦截器统一处理
    console.error('[photo-review] 点评失败:', err);
  } finally {
    stopWaiting();
    submitting.value = false;
  }
}
</script>

<template>
  <PhotoWall :seed="20260911" />

  <div v-loading="loading" class="tool-page">
    <template v-if="tool">
      <ToolPageHeader
        :crumb="`TOOLS / ${tool.id.toUpperCase()}`"
        :icon="tool.icon"
        :title="tool.name"
        back-to="/"
        variant="wall"
      />

      <div class="review-layout">
        <!-- 左列：上传与描述 -->
        <section class="input-panel">
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
            <img :src="imageDataUrl" alt="待点评照片" />
            <div class="preview-meta">
              <span class="preview-name" :title="fileName">{{ fileName }}</span>
              <button class="pill" :disabled="submitting" @click="removeImage">换一张</button>
            </div>
          </div>

          <div class="note-field">
            <label class="note-label" for="note-input">
              拍摄说明<span class="note-optional">（可选）</span>
            </label>
            <textarea
              id="note-input"
              v-model="note"
              class="note-input"
              :class="{ over: noteOver }"
              rows="3"
              placeholder="拍的是什么？当时想表达什么？有什么背景？"
            ></textarea>
            <p class="note-count" :class="{ over: noteOver }">{{ noteCount }} / {{ NOTE_MAX }}</p>
          </div>

          <SubmitButton
            :loading="submitting"
            :disabled="!canSubmit"
            label="开始点评"
            loading-label="点评中，通常 10–60 秒"
            @click="submit"
          />
        </section>

        <!-- 右列：点评结果 -->
        <section class="result-panel" :class="{ filled: reviewHtml !== '' }">
          <div v-if="reviewHtml === ''" class="result-empty">
            <!-- 等待态：拍立得卡片晃动 + 轮播文案 + 计时；只播报阶段切换，秒数对读屏隐藏 -->
            <template v-if="submitting">
              <div class="developing" aria-hidden="true">
                <span v-for="n in 3" :key="n" class="polaroid"></span>
              </div>
              <div role="status" aria-live="polite">
                <p class="re-title">{{ stageLabel }}</p>
                <p class="re-desc" aria-hidden="true">
                  已等待 {{ elapsed }} 秒 · 超时上限 {{ REVIEW_TIMEOUT_S }} 秒
                </p>
              </div>
            </template>
            <EmptyState
              v-else
              :icon="Picture"
              title="点评会出现在这里"
              desc="上传照片后提交，等博主开麦"
            />
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-else class="review-body" v-html="reviewHtml"></div>
          <!-- AI 免责提示：出点评后展示 -->
          <p v-if="reviewHtml !== ''" class="ai-disclaimer">以上点评由 AI 生成，观点仅供参考。</p>
        </section>
      </div>
    </template>

    <NotFoundState v-else-if="notFound" title="未找到该工具" desc="可能已被下线或禁用" />
  </div>
</template>

<style scoped>
/* 内容层盖在照片墙之上 */
.tool-page {
  position: relative;
  z-index: 1;
  min-height: calc(100vh - 64px);
  min-height: calc(100dvh - 64px);
  max-width: 1060px;
  margin: 0 auto;
  padding: clamp(16px, 2.667vh, 32px) clamp(20px, 4vw, 40px);
}

/* ===== 双栏布局 ===== */
.review-layout {
  display: grid;
  grid-template-columns: minmax(300px, 5fr) 7fr;
  gap: 22px;
  align-items: start;
}

@media (max-width: 880px) {
  .review-layout {
    grid-template-columns: 1fr;
  }
}

/* ===== 左列：上传与描述 ===== */
.input-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--bg2);
  padding: 20px;
}

.dropzone {
  border: 1px dashed rgba(255, 255, 255, 0.22);
  border-radius: 12px;
  padding: 40px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.25s var(--ease), background 0.25s var(--ease);
}

.dropzone:hover {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.03);
}

/* 焦点环交给全局 :focus-visible 提供，此处只加强边框辅助 */
.dropzone:focus-visible {
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.05);
}

/* 线性图标：与 ToolIcon 同族，替换彩色 emoji */
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

/* 换一张按钮：压缩全局 pill 尺寸；点评进行中禁用（防止丢掉进行中的请求） */
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

/* ===== 描述输入 ===== */
.note-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-label {
  font-size: 13.5px;
  color: var(--ink);
}

.note-optional {
  color: var(--muted);
  font-size: 12px;
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

.note-count {
  margin: 0;
  text-align: right;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
}

/* 超 500 字：描边与计数转红，提交同步禁用（与其他三个工具一致） */
.note-input.over {
  border-color: rgba(245, 108, 108, 0.65);
}

.note-count.over {
  color: var(--danger);
}

/* ===== 右列：点评结果 ===== */
.result-panel {
  min-height: 320px;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--bg2);
  padding: 26px 28px;
}

.result-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  text-align: center;
}

/* 等待态文案：与空态文字同字号，轮播文案 + 秒数 */
.re-title {
  margin: 0 0 6px;
  font-size: 15.5px;
  font-weight: 500;
  color: var(--ink);
}

.re-desc {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

/* ===== 等待动画：三张拍立得依次显影晃动 ===== */
.developing {
  display: flex;
  gap: 12px;
  margin-bottom: 18px;
}

.polaroid {
  position: relative;
  width: 36px;
  height: 44px;
  border-radius: 4px;
  background: #f2f0e9;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}

/* 相纸内的"照片"区域：深色渐变 + 显影进度 */
.polaroid::after {
  content: '';
  position: absolute;
  inset: 4px 4px 9px;
  border-radius: 2px;
  background: linear-gradient(160deg, #2a3550, #55407a);
  animation: develop 1.8s var(--ease) infinite;
}

.polaroid:nth-child(1) {
  transform: rotate(-6deg);
}

.polaroid:nth-child(2) {
  transform: rotate(3deg) translateY(-6px);
  animation: bob 1.6s ease-in-out 0.25s infinite;
}

.polaroid:nth-child(3) {
  transform: rotate(8deg);
  animation: bob 1.6s ease-in-out 0.5s infinite;
}

.polaroid:nth-child(1)::after {
  animation-delay: 0s;
}

.polaroid:nth-child(2)::after {
  animation-delay: 0.3s;
}

.polaroid:nth-child(3)::after {
  animation-delay: 0.6s;
}

/* 上下轻微浮动 */
@keyframes bob {
  0%,
  100% {
    transform: rotate(3deg) translateY(-6px);
  }

  50% {
    transform: rotate(3deg) translateY(-12px);
  }
}

/* 照片区域明暗交替，模拟"显影中" */
@keyframes develop {
  0%,
  100% {
    opacity: 0.45;
    filter: brightness(0.6);
  }

  50% {
    opacity: 1;
    filter: brightness(1.15);
  }
}

/* ===== Markdown 排版（v-html 内容需 :deep）===== */
.review-body {
  font-size: 15px;
  line-height: 1.9;
  color: var(--ink);
  word-break: break-word;
}

.review-body :deep(p) {
  margin: 0 0 14px;
}

.review-body :deep(strong) {
  color: #ffffff;
}

.review-body :deep(blockquote) {
  margin: 0 0 14px;
  padding: 4px 0 4px 14px;
  border-left: 2px solid rgba(255, 255, 255, 0.25);
  color: var(--muted);
}

.review-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  margin: 6px 0;
  display: block;
}

.review-body :deep(ul),
.review-body :deep(ol) {
  margin: 0 0 14px;
  padding-left: 22px;
}

.review-body :deep(li) {
  margin: 4px 0;
}

.review-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--rule);
  margin: 20px 0;
}

/* AI 免责提示：点评底部 */
.ai-disclaimer {
  margin: 16px 0 0;
  padding-top: 12px;
  border-top: 1px dashed var(--rule);
  font-size: 12px;
  color: var(--muted);
}

/* ===== 入场动画 ===== */
@media (prefers-reduced-motion: no-preference) {
  .review-layout {
    animation: rise 0.8s 0.16s var(--ease) both;
  }
}
</style>
