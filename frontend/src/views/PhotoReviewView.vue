<script setup lang="ts">
// 照片点评工具页：上传单张照片 + 可选拍摄描述，提交后展示多模态 LLM 的 Markdown 点评
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { reviewPhoto } from '@/api/ai';
import ToolIcon from '@/components/ToolIcon.vue';
import { useToolsStore } from '@/stores/tools';

/** 点评请求超时上限（与 api/ai.ts 单请求 timeout 一致） */
const REVIEW_TIMEOUT_S = 120;

/** 等待期轮播文案（点评生成通常 10-60 秒，轮播缓解焦虑） */
const FUN_STATUS = [
  '博主正在眯眼看图…',
  '构图鉴定中…',
  '光线分析中…',
  '毒辣措辞酝酿中…',
  '分数纠结中…',
];

const route = useRoute();
const router = useRouter();
const toolsStore = useToolsStore();
const loadingTools = ref(true);

/* ===== 背景照片墙：assets/bg-photos 全量收集，数量自适应 ===== */
interface BgPhoto {
  src: string;
  left: number; // %
  top: number; // %
  width: number; // vw
  rotate: number; // deg
  z: number;
}

/** 确定性伪随机（mulberry32）：布局抖动每次刷新稳定，避免渲染跳动 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bgPhotos: BgPhoto[] = (() => {
  const srcs = Object.values(
    import.meta.glob<string>('../assets/bg-photos/*.jpg', {
      eager: true,
      query: '?url',
      import: 'default',
    }),
  );
  const rand = seededRandom(20260911);
  // 粗略 3 列抖动网格铺满视口，超出裁剪
  const cols = 3;
  return srcs.map((src, i) => ({
    src,
    left: (i % cols) * 33 + rand() * 18 - 4,
    top: Math.floor(i / cols) * 26 + rand() * 16 - 6,
    width: 22 + rand() * 8,
    rotate: rand() * 16 - 8,
    z: 1 + Math.floor(rand() * 9),
  }));
})();

/** 聚光灯轮播：每 3 秒切换选中照片（尊重 prefers-reduced-motion） */
const spotlightIndex = ref(0);
let spotlightTimer: ReturnType<typeof setInterval> | undefined;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

onMounted(async () => {
  if (!prefersReducedMotion && bgPhotos.length > 1) {
    spotlightTimer = setInterval(() => {
      spotlightIndex.value = (spotlightIndex.value + 1) % bgPhotos.length;
    }, 3000);
  }
  try {
    // 直接通过 URL 访问时工具列表可能尚未加载
    await toolsStore.fetchTools(true);
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loadingTools.value = false;
  }
});

const toolId = computed(() => String(route.params.id ?? 'photo-review'));
const tool = computed(() => toolsStore.tools.find((t) => t.id === toolId.value));

/** 允许的图片类型与大小上限 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 8;

const fileInput = ref<HTMLInputElement>();
const imageDataUrl = ref('');
const fileName = ref('');
const note = ref('');
const submitting = ref(false);
const reviewHtml = ref('');

/** 等待态：轮播文案索引与已等待秒数 */
const funStatusIndex = ref(0);
const elapsed = ref(0);
let statusTimer: ReturnType<typeof setInterval> | undefined;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

onUnmounted(() => {
  clearInterval(statusTimer);
  clearInterval(elapsedTimer);
  clearInterval(spotlightTimer);
});

/** 拍摄描述字数（上限 500，与后端一致） */
const NOTE_MAX = 500;
const noteCount = computed(() => note.value.trim().length);

/** 提交按钮可用态 */
const canSubmit = computed(() => imageDataUrl.value !== '' && !submitting.value);

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

/** 启动/停止等待态的轮播与计时 */
function startWaiting() {
  funStatusIndex.value = 0;
  elapsed.value = 0;
  statusTimer = setInterval(() => {
    funStatusIndex.value = (funStatusIndex.value + 1) % FUN_STATUS.length;
  }, 2500);
  elapsedTimer = setInterval(() => {
    elapsed.value += 1;
  }, 1000);
}

function stopWaiting() {
  clearInterval(statusTimer);
  clearInterval(elapsedTimer);
  statusTimer = undefined;
  elapsedTimer = undefined;
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
  <!-- 背景照片墙：相纸边框 + 错乱排布 + 聚光灯轮播，不参与交互 -->
  <div v-if="bgPhotos.length" class="photo-wall" aria-hidden="true">
    <div
      v-for="(p, i) in bgPhotos"
      :key="p.src"
      class="wall-photo"
      :class="{ active: i === spotlightIndex }"
      :style="{
        left: `${p.left}%`,
        top: `${p.top}%`,
        width: `${p.width}vw`,
        '--rot': `${p.rotate}deg`,
        '--z': p.z,
      }"
    >
      <img :src="p.src" alt="" />
    </div>
    <!-- 强蒙层 + vignette：可读性优先 -->
    <div class="wall-veil"></div>
  </div>

  <div v-loading="loadingTools" class="tool-page">
    <template v-if="tool">
      <!-- 眉题：等宽面包屑 -->
      <p class="crumb">TOOLS / {{ tool.id.toUpperCase() }}</p>

      <div class="tool-header">
        <span class="tool-icon"><ToolIcon :name="tool.icon" /></span>
        <h2 class="tool-title">{{ tool.name }}</h2>
        <button class="back-btn" @click="router.push('/')">← 返回工具箱</button>
      </div>

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
            <p class="dz-icon">📷</p>
            <p class="dz-title">点击或拖入照片</p>
            <p class="dz-desc">jpg / png / webp，不超过 8MB，一次一张</p>
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
              :maxlength="NOTE_MAX"
              rows="3"
              placeholder="拍的是什么？当时想表达什么？有什么背景？"
            ></textarea>
            <p class="note-count">{{ noteCount }} / {{ NOTE_MAX }}</p>
          </div>

          <button class="submit-btn" :disabled="!canSubmit" @click="submit">
            <span v-if="!submitting">开始点评</span>
            <span v-else class="submitting">
              <span class="spinner"></span>
              点评中，通常 10–60 秒
            </span>
          </button>
        </section>

        <!-- 右列：点评结果 -->
        <section class="result-panel" :class="{ filled: reviewHtml !== '' }">
          <div v-if="reviewHtml === ''" class="result-empty">
            <!-- 等待态：拍立得卡片晃动 + 轮播文案 + 计时 -->
            <template v-if="submitting">
              <div class="developing" aria-hidden="true">
                <span v-for="n in 3" :key="n" class="polaroid"></span>
              </div>
              <p class="re-title">{{ FUN_STATUS[funStatusIndex] }}</p>
              <p class="re-desc">已等待 {{ elapsed }} 秒 · 超时上限 {{ REVIEW_TIMEOUT_S }} 秒</p>
            </template>
            <template v-else>
              <p class="re-icon">🎞️</p>
              <p class="re-title">点评会出现在这里</p>
              <p class="re-desc">上传照片后提交，等博主开麦</p>
            </template>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-else class="review-body" v-html="reviewHtml"></div>
          <!-- AI 免责提示：出点评后展示 -->
          <p v-if="reviewHtml !== ''" class="ai-disclaimer">以上点评由 AI 生成，观点仅供参考。</p>
        </section>
      </div>
    </template>

    <div v-else-if="!loadingTools" class="notfound">
      <p class="nf-code">404</p>
      <p class="nf-title">未找到该工具</p>
      <p class="nf-desc">可能已被下线或禁用</p>
    </div>
  </div>
</template>

<style scoped>
/* ===== 背景照片墙：fixed 全屏，置于内容之下，不挡交互 ===== */
.photo-wall {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

/* 内容层盖在照片墙之上 */
.tool-page {
  position: relative;
  z-index: 1;
  min-height: calc(100vh - 64px);
  max-width: 1060px;
  margin: 0 auto;
  padding: clamp(48px, 8vh, 96px) clamp(20px, 4vw, 40px);
}

/* 单张照片：白色相纸边框（底部略宽，显影相纸感） */
.wall-photo {
  position: absolute;
  transform: rotate(var(--rot));
  z-index: var(--z);
  border-radius: 2px;
  background: #f2f0e9;
  padding: 6px 6px 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.wall-photo img {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 1px;
  filter: brightness(0.45) saturate(0.85);
  transform: scale(0.97);
  transition: filter 0.8s var(--ease), transform 0.8s var(--ease);
}

/* 聚光灯选中态：提亮放大 + 层叠提升 + 相纸微发光 */
.wall-photo.active {
  z-index: 40;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.6), 0 0 26px rgba(255, 255, 255, 0.22);
}

.wall-photo.active img {
  filter: brightness(1) saturate(1);
  transform: scale(1.06);
}

/* 蒙层：黑色遮罩 + 中心 vignette，压到可辨认照片但保内容可读 */
.wall-veil {
  position: absolute;
  inset: 0;
  z-index: 50;
  background:
    radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.35) 100%),
    rgba(3, 3, 5, 0.5);
}

/* 减少动态偏好：停用轮播过渡 */
@media (prefers-reduced-motion: reduce) {
  .wall-photo,
  .wall-photo img {
    transition: none;
  }
}

.crumb {
  margin: 0 0 26px;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--strip);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 36px;
}

.tool-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 26px;
}

.tool-title {
  margin: 0;
  font-size: clamp(28px, 4vw, 38px);
  font-weight: 300;
  letter-spacing: 0.01em;
  color: var(--ink);
}

/* ===== 返回工具箱按钮（复用全局 pill，压缩尺寸）===== */
.back-btn {
  margin-left: auto;
  height: 38px;
  min-width: 0;
  padding: 0 18px;
  font-size: 13.5px;
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

.dropzone:hover,
.dropzone:focus-visible {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.03);
  outline: none;
}

.dz-icon {
  margin: 0 0 10px;
  font-size: 30px;
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

.note-input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
}

.note-count {
  margin: 0;
  text-align: right;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
}

/* ===== 提交按钮 ===== */
.submit-btn {
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 999px;
  background: #ffffff;
  color: #050505;
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 12px 20px;
  cursor: pointer;
  transition: opacity 0.25s var(--ease), transform 0.25s var(--ease);
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.submit-btn:disabled {
  background: rgba(255, 255, 255, 0.1);
  color: var(--muted);
  border-color: var(--rule);
  cursor: not-allowed;
}

.submitting {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(5, 5, 5, 0.25);
  border-top-color: #050505;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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

.re-icon {
  margin: 0 0 12px;
  font-size: 30px;
  opacity: 0.7;
}

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

/* ===== 未找到态 ===== */
.notfound {
  text-align: center;
  padding: clamp(44px, 10vh, 88px) 0;
}

.nf-code {
  margin: 0;
  font-family: var(--mono);
  font-size: clamp(48px, 8vw, 72px);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.14);
  line-height: 1;
}

.nf-title {
  margin: 18px 0 6px;
  font-size: 19px;
  font-weight: 500;
  color: var(--ink);
}

.nf-desc {
  margin: 0 0 28px;
  font-size: 14px;
  color: var(--muted);
}

/* ===== 入场动画 ===== */
@media (prefers-reduced-motion: no-preference) {
  .crumb {
    animation: rise 0.7s 0.02s var(--ease) both;
  }

  .tool-header {
    animation: rise 0.8s 0.08s var(--ease) both;
  }

  .review-layout {
    animation: rise 0.8s 0.16s var(--ease) both;
  }
}
</style>
