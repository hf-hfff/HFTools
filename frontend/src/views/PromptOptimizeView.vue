<script setup lang="ts">
// 提示词优化工具页：级别 + 场景选择 + 草稿输入，提交后展示 LLM 的 Markdown 优化结果
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { EditPen } from '@element-plus/icons-vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { optimizePrompt } from '@/api/ai';
import EmptyState from '@/components/EmptyState.vue';
import NotFoundState from '@/components/NotFoundState.vue';
import SubmitButton from '@/components/SubmitButton.vue';
import ToolIcon from '@/components/ToolIcon.vue';
import ToolPageHeader from '@/components/ToolPageHeader.vue';
import { useLongTask } from '@/composables/useLongTask';
import { useToolMeta } from '@/composables/useToolMeta';

/** 优化请求超时上限（与 api/ai.ts 单请求 timeout 一致） */
const OPTIMIZE_TIMEOUT_S = 120;

/** 等待期轮播文案（优化生成通常 10-60 秒） */
const FUN_STATUS = [
  '正在拆解你的提示词…',
  '检查目标与上下文…',
  '重组结构中…',
  '补充约束与边界…',
  '打磨输出格式…',
];

/** 级别与场景选项（与后端枚举一致） */
const LEVELS = [
  { value: 'user', label: '用户提示词' },
  { value: 'system', label: '系统提示词' },
] as const;
const SCENES = [
  {
    value: 'text',
    label: '文本',
    icon: 'document',
    tooltip: '优化文章、文案、分析报告等文本任务的提示词',
  },
  {
    value: 'image',
    label: '图片',
    icon: 'image',
    tooltip: '优化用于图像生成的主体、风格、构图与光线描述',
  },
  {
    value: 'video',
    label: '视频',
    icon: 'video-camera',
    tooltip: '优化用于视频生成的镜头、运镜、时序与氛围描述',
  },
  {
    value: 'code',
    label: 'Code',
    icon: 'code',
    tooltip: '优化包含技术栈、输入输出、约束和验收标准的开发提示词',
  },
] as const;

type Level = (typeof LEVELS)[number]['value'];
type Scene = (typeof SCENES)[number]['value'];

/** 快速开始示例：绑定默认级别与场景，内容为待优化的草稿提示词 */
const EXAMPLES: Array<{ name: string; description: string; icon: string; level: Level; scene: Scene; draft: string }> = [
  {
    name: '商业计划书',
    description: '梳理项目价值与商业逻辑',
    icon: 'briefcase',
    level: 'user',
    scene: 'text',
    draft: '请帮我撰写一份关于[项目/产品名称]的商业计划书，用于[融资/内部评审/市场验证]。目标读者是[投资人/管理层/合作伙伴]，请重点覆盖[市场机会、商业模式、竞争优势、财务预测等内容]。'
  },
  {
    name: '营销文案',
    description: '提炼卖点与表达风格',
    icon: 'promotion',
    level: 'user',
    scene: 'text',
    draft: '请为[产品/服务名称]撰写一段用于[发布平台]的营销文案。目标受众是[目标用户]，核心卖点包括[卖点1、卖点2]，希望传达的品牌语气是[专业/亲切/活泼等]，篇幅控制在[字数范围]以内。'
  },
  {
    name: '需求分析',
    description: '明确目标、范围与验收标准',
    icon: 'document-checked',
    level: 'user',
    scene: 'text',
    draft: '请分析以下产品需求：[需求描述]。使用场景是[业务背景]，目标用户是[用户群体]。请从[用户价值、功能范围、交互流程、风险与依赖]等方面展开，输出[文档形式/结构]。'
  },
  {
    name: '数据分析',
    description: '从数据中发现趋势与结论',
    icon: 'trend-charts',
    level: 'user',
    scene: 'text',
    draft: '请分析这份[数据集名称/数据描述]，数据时间范围为[时间范围]，分析目标是[业务问题]。请重点关注[指标、趋势、异常或分组维度]，输出主要发现、依据和可执行建议。'
  },
  {
    name: '邮件模板',
    description: '统一语气与邮件结构',
    icon: 'message',
    level: 'system',
    scene: 'text',
    draft: '你是一名[角色/领域]邮件助手。请将用户提供的内容改写为适合发送给[收件人/关系]的[正式/友好/简洁]邮件，保留原意，补充合适的主题、称呼和结尾。输出语言为[中文/英文]，不要编造未提供的信息。'
  },
];

const route = useRoute();
const { tool, loading, notFound } = useToolMeta(() =>
  String(route.params.id ?? 'prompt-engineering'),
);

/* ===== 背景视频（本地自托管，桌面才加载 720p，≤900px 与减动效只留海报）===== */
const backgroundVideo = ref<HTMLVideoElement>();
const videoAvailable = ref(true);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const wideEnough = window.matchMedia('(min-width: 900px)');

/**
 * 只在「未开启减动效 + 视口 ≥900px」时才触发加载与播放：
 * preload="none" 下不调用 play() 就不会请求 mp4，移动端与减动效用户只拿到本地海报
 */
function syncBackgroundVideo() {
  const el = backgroundVideo.value;
  if (!el) return;
  if (reducedMotion.matches || !wideEnough.matches) {
    el.pause();
  } else if (videoAvailable.value) {
    void el.play().catch(() => undefined);
  }
}

function handleVideoError() {
  videoAvailable.value = false;
}

onMounted(() => {
  reducedMotion.addEventListener('change', syncBackgroundVideo);
  wideEnough.addEventListener('change', syncBackgroundVideo);
  syncBackgroundVideo();
});

onUnmounted(() => {
  reducedMotion.removeEventListener('change', syncBackgroundVideo);
  wideEnough.removeEventListener('change', syncBackgroundVideo);
});

/* ===== 表单状态 ===== */
const level = ref<Level>('user');
const scene = ref<Scene>('text');
const draft = ref('');
const submitting = ref(false);
const resultHtml = ref('');
const resultPromptHtml = ref('');
const resultChangesHtml = ref('');
const resultMarkdown = ref('');

/** 输入字数（上限 500，与后端一致） */
const PROMPT_MAX = 500;
const draftCount = computed(() => draft.value.length);
const overLimit = computed(() => draftCount.value > PROMPT_MAX);
const canSubmit = computed(
  () => draft.value.trim() !== '' && !overLimit.value && !submitting.value,
);

/** 快速开始：填充草稿并切换到示例绑定的级别与场景 */
function applyExample(ex: (typeof EXAMPLES)[number]) {
  draft.value = ex.draft;
  level.value = ex.level;
  scene.value = ex.scene;
}

function clearDraft() {
  draft.value = '';
}

/** 等待态：秒数计时 + 文案轮播（与照片点评页同节奏） */
const {
  elapsed,
  stageLabel,
  start: startWaiting,
  stop: stopWaiting,
} = useLongTask({
  timeoutS: OPTIMIZE_TIMEOUT_S,
  stages: FUN_STATUS.map((label) => ({ label })),
  rotateMs: 2500,
});

/** 是否前端 axios 超时（无响应，code 为 ECONNABORTED） */
function isTimeoutError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ECONNABORTED';
}

/**
 * marked 按 CommonMark 边界规则，「**加粗。**紧跟中文」不渲染成 strong（LLM 常见输出），
 * 解析前统一把 **…** 预转为 <strong>，DOMPurify 净化兜底
 */
function normalizeBold(md: string): string {
  return md.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
}

function splitResultHtml(html: string): { prompt: string; changes: string } {
  const container = document.createElement('div');
  container.innerHTML = html;
  const changeHeading = Array.from(container.querySelectorAll('h2')).find(
    (heading) => heading.textContent?.trim() === '改动说明',
  );

  if (!changeHeading) return { prompt: html, changes: '' };

  const prompt = document.createElement('div');
  const changes = document.createElement('div');
  let inChanges = false;

  for (const node of Array.from(container.childNodes)) {
    if (node === changeHeading) inChanges = true;
    (inChanges ? changes : prompt).append(node.cloneNode(true));
  }

  return { prompt: prompt.innerHTML, changes: changes.innerHTML };
}

/** 提交优化 */
async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  resultHtml.value = '';
  resultPromptHtml.value = '';
  resultChangesHtml.value = '';
  resultMarkdown.value = '';
  startWaiting();
  try {
    const { result } = await optimizePrompt({
      prompt: draft.value.trim(),
      level: level.value,
      scene: scene.value,
    });
    resultMarkdown.value = result;
    // LLM 输出的 Markdown 先净化再渲染，防注入
    resultHtml.value = DOMPurify.sanitize(
      marked.parse(normalizeBold(result), { async: false }),
    );
    const sections = splitResultHtml(resultHtml.value);
    resultPromptHtml.value = sections.prompt;
    resultChangesHtml.value = sections.changes;
  } catch (err) {
    if (isTimeoutError(err)) {
      // 前端等待超时：关掉拦截器的通用 toast，弹窗说明具体原因
      ElMessage.closeAll();
      ElMessageBox.alert(
        `本次优化超过 ${OPTIMIZE_TIMEOUT_S} 秒仍未完成。常见原因：模型服务响应缓慢、网络波动。建议稍后重试，或精简提示词后再次提交。`,
        '优化超时',
        { confirmButtonText: '知道了', type: 'warning' },
      );
    }
    // 其余 HTTP 错误（含后端 504 LLM_TIMEOUT、502 上游错误）提示已由 axios 拦截器统一处理
    console.error('[prompt-optimize] 优化失败:', err);
  } finally {
    stopWaiting();
    submitting.value = false;
  }
}

/** 一键复制：复制完整结果 Markdown */
async function copyResult() {
  try {
    await navigator.clipboard.writeText(resultMarkdown.value);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.error('复制失败，请手动选择复制');
  }
}

/** 下载 .md 文件：文件名含工具名与时间戳 */
function downloadResult() {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 15)
    .replace(/(\d{8})(\d{6})/, '$1_$2');
  const blob = new Blob([resultMarkdown.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `提示词优化_${ts}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div v-loading="loading" class="tool-page">
    <video
      ref="backgroundVideo"
      class="page-background-video"
      poster="/videos/prompt-bg-poster.webp"
      preload="none"
      muted
      loop
      playsinline
      aria-hidden="true"
      tabindex="-1"
      @error="handleVideoError"
    >
      <source media="(max-width: 900px)" src="/videos/prompt-bg-540.mp4" type="video/mp4" />
      <source src="/videos/prompt-bg-720.mp4" type="video/mp4" />
    </video>
    <div class="page-background-mask" aria-hidden="true"></div>

    <div class="tool-page-content">
      <template v-if="tool">
      <ToolPageHeader
        :crumb="`TOOLS / ${tool.id.toUpperCase()}`"
        :icon="tool.icon"
        :title="tool.name"
        back-to="/"
      />

      <div class="opt-layout">
        <!-- 左列：配置与输入 -->
        <section class="input-panel">
          <!-- 级别 -->
          <div class="field">
            <p class="field-label">提示词级别</p>
            <div class="level-switch" role="radiogroup" aria-label="提示词级别">
              <button
                v-for="lv in LEVELS"
                :key="lv.value"
                class="level-option"
                :class="{ on: level === lv.value }"
                role="radio"
                :aria-checked="level === lv.value"
                :disabled="submitting"
                @click="level = lv.value"
              >
                {{ lv.label }}
              </button>
            </div>
          </div>

          <!-- 场景 -->
          <div class="field">
            <p class="field-label">应用场景</p>
            <div class="seg-group" role="radiogroup" aria-label="应用场景">
              <el-tooltip
              v-for="sc in SCENES"
              :key="sc.value"
              :content="sc.tooltip"
              placement="top"
            >
              <button
                class="scene-item"
                :class="{ on: scene === sc.value }"
                role="radio"
                :aria-checked="scene === sc.value"
                :disabled="submitting"
                @click="scene = sc.value"
              >
                <ToolIcon :name="sc.icon" />
                <span>{{ sc.label }}</span>
              </button>
            </el-tooltip>
            </div>
          </div>

          <!-- 快速开始示例 -->
          <div class="field">
            <p class="field-label">快速开始<span class="field-optional">（点击填充示例）</span></p>
            <div class="example-grid">
              <button
                v-for="ex in EXAMPLES"
                :key="ex.name"
                class="example-card"
                :disabled="submitting"
                @click="applyExample(ex)"
              >
                <span class="example-icon"><ToolIcon :name="ex.icon" /></span>
                <span class="example-copy">
                  <strong>{{ ex.name }}</strong>
                  <small>{{ ex.description }}</small>
                </span>
                <span class="example-arrow" aria-hidden="true">↗</span>
              </button>
            </div>
          </div>

          <!-- 草稿输入 -->
          <div class="draft-field">
            <div class="draft-label-row">
              <label class="field-label" for="draft-input">待优化提示词</label>
              <button
                class="clear-draft-btn"
                :disabled="draft === '' || submitting"
                @click="clearDraft"
              >
                清空
              </button>
            </div>
            <textarea
              id="draft-input"
              v-model="draft"
              class="draft-input"
              rows="6"
              placeholder="粘贴你的草稿提示词，越具体越好。不知道怎么写？点上面的快速开始试试。"
            ></textarea>
            <p class="draft-count" :class="{ over: overLimit }">
              {{ draftCount }} / {{ PROMPT_MAX }}
            </p>
          </div>

          <SubmitButton
            :loading="submitting"
            :disabled="!canSubmit"
            label="开始优化"
            loading-label="优化中，通常 10–60 秒"
            @click="submit"
          />
        </section>

        <!-- 右列：优化结果 -->
        <section class="result-panel" :class="{ filled: resultHtml !== '' }">
          <div v-if="resultHtml === ''" class="result-empty">
            <template v-if="submitting">
              <div class="prompt-assembly" aria-hidden="true">
                <span class="prompt-node prompt-node-input"><i></i><i></i><i></i></span>
                <span class="assembly-link"></span>
                <span class="prompt-node prompt-node-process"><i></i><i></i><i></i></span>
                <span class="assembly-link"></span>
                <span class="prompt-node prompt-node-output"><i></i><i></i><i></i></span>
              </div>
              <div role="status" aria-live="polite">
                <p class="re-title">{{ stageLabel }}</p>
                <p class="re-desc" aria-hidden="true">
                  已等待 {{ elapsed }} 秒 · 超时上限 {{ OPTIMIZE_TIMEOUT_S }} 秒
                </p>
              </div>
            </template>
            <EmptyState
              v-else
              :icon="EditPen"
              title="优化结果会出现在这里"
              desc="输入草稿提示词，或点一个快速开始示例"
            />
          </div>
          <template v-else>
            <div class="result-prompt">
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div class="result-body" v-html="resultPromptHtml"></div>
            </div>
            <div class="result-actions">
              <button class="pill action-btn" @click="copyResult">复制</button>
              <button class="pill action-btn" @click="downloadResult">下载 md</button>
            </div>
            <div v-if="resultChangesHtml !== ''" class="result-changes">
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div class="result-body" v-html="resultChangesHtml"></div>
            </div>
            <p class="ai-disclaimer">以上结果由 AI 生成，观点仅供参考。</p>
          </template>
        </section>
      </div>
    </template>

      <NotFoundState v-else-if="notFound" title="未找到该工具" desc="可能已被下线或禁用" />
    </div>
  </div>
</template>

<style scoped>
.tool-page {
  position: relative;
  min-height: calc(100dvh - 64px);
  overflow: hidden;
  background: #000000;
}

.page-background-video,
.page-background-mask {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.page-background-video {
  z-index: 0;
  object-fit: cover;
  /* 首帧海报兜底：视频未加载/解码失败时仍有画面（preload=none 下移动端只显示它） */
  background: #050505 url('/videos/prompt-bg-poster.webp') center / cover no-repeat;
}

.page-background-mask {
  z-index: 1;
  background: rgba(0, 0, 0, 0.5);
}

.tool-page-content {
  position: relative;
  z-index: 2;
  max-width: 1060px;
  min-height: calc(100dvh - 64px);
  margin: 0 auto;
  padding: clamp(16px, 2.667vh, 32px) clamp(20px, 4vw, 40px);
  box-sizing: border-box;
}

/* ===== 双栏布局 ===== */
.opt-layout {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 22px;
  align-items: start;
}

.opt-layout > * {
  min-width: 0;
}

@media (max-width: 880px) {
  .opt-layout {
    grid-template-columns: 1fr;
  }
}

/* ===== 左列：配置与输入 ===== */
.input-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--bg2);
  padding: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-label {
  margin: 0;
  font-size: 13.5px;
  color: var(--ink);
}

.field-optional {
  color: var(--muted);
  font-size: 12px;
}

/* 分段选择器：级别 / 场景 */
.level-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.level-option {
  min-height: 34px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.25s var(--ease);
}

.level-option:hover:not(:disabled):not(.on) {
  color: var(--ink);
}

.level-option.on {
  background: #ffffff;
  color: #050505;
  font-weight: 600;
}

.level-option:disabled,
.scene-item:disabled,
.example-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.seg-group {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.scene-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  font-size: 13px;
  padding: 8px 13px;
  cursor: pointer;
  transition: all 0.25s var(--ease);
}

.scene-item :deep(.el-icon) {
  font-size: 16px;
}

.scene-item:hover:not(:disabled):not(.on) {
  border-color: rgba(255, 255, 255, 0.35);
  color: var(--ink);
}

.scene-item.on {
  border-color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.1);
  color: var(--ink);
}

.example-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.example-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--muted);
  text-align: left;
  padding: 11px 12px;
  cursor: pointer;
  transition: border-color 0.25s var(--ease), background 0.25s var(--ease), transform 0.25s var(--ease);
}

.example-card:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.08);
  color: var(--ink);
  transform: translateY(-1px);
}

.example-card:last-child {
  grid-column: 1 / -1;
}

.example-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  color: var(--ink);
}

.example-icon :deep(.el-icon) {
  font-size: 15px;
}

.example-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.example-copy strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.example-copy small {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.example-arrow {
  margin-left: auto;
  align-self: flex-start;
  color: var(--strip);
  font-size: 15px;
  line-height: 1;
}

/* ===== 草稿输入 ===== */
.draft-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.draft-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.clear-draft-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}

.clear-draft-btn:hover:not(:disabled) {
  color: var(--ink);
}

.clear-draft-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.draft-input {
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
.draft-input:focus {
  border-color: rgba(255, 255, 255, 0.4);
}

.draft-count {
  margin: 0;
  text-align: right;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
}

.draft-count.over {
  color: var(--danger);
}

/* ===== 右列：优化结果 ===== */
.result-panel {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
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

.prompt-assembly {
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(100%, 290px);
  margin-bottom: 22px;
}

.prompt-node {
  display: grid;
  gap: 6px;
  width: 58px;
  padding: 11px 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  animation: node-pulse 2.1s var(--ease) infinite;
}

.prompt-node i {
  display: block;
  height: 3px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.34);
}

.prompt-node i:nth-child(2) {
  width: 78%;
}

.prompt-node i:nth-child(3) {
  width: 58%;
}

.prompt-node-process {
  animation-delay: 0.32s;
}

.prompt-node-output {
  animation-delay: 0.64s;
}

.assembly-link {
  position: relative;
  width: 26px;
  height: 1px;
  margin: 0 5px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.2);
}

.assembly-link::after {
  position: absolute;
  inset: -1px auto -1px 0;
  width: 11px;
  content: '';
  background: #ffffff;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.9);
  animation: link-flow 1.7s var(--ease) infinite;
}

.assembly-link:nth-of-type(4)::after {
  animation-delay: 0.25s;
}

@keyframes node-pulse {
  0%,
  100% {
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.04);
    box-shadow: none;
    opacity: 0.62;
    transform: translateY(2px);
  }

  45% {
    border-color: rgba(255, 255, 255, 0.7);
    background: rgba(255, 255, 255, 0.1);
    box-shadow: 0 0 20px rgba(205, 186, 255, 0.2);
    opacity: 1;
    transform: translateY(-3px);
  }
}

@keyframes link-flow {
  0% {
    transform: translateX(-18px);
  }

  65%,
  100% {
    transform: translateX(32px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .prompt-node,
  .assembly-link::after {
    animation: none;
  }
}

/* ===== Markdown 排版（v-html 内容需 :deep）===== */
.result-prompt {
  width: 100%;
  min-height: 280px;
  max-height: 560px;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 8px;
}

.result-changes {
  min-width: 0;
  margin-top: 22px;
  overflow-x: auto;
}

.result-body {
  min-width: 0;
  font-size: 15px;
  line-height: 1.9;
  color: var(--ink);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.result-body :deep(p) {
  margin: 0 0 14px;
}

.result-body :deep(strong) {
  color: #ffffff;
}

.result-body :deep(h2) {
  margin: 22px 0 12px;
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
}

.result-body :deep(h2:first-child) {
  margin-top: 0;
}

.result-changes .result-body :deep(table) {
  width: 100%;
  max-width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin: 0 0 14px;
  font-size: 13.5px;
  line-height: 1.7;
}

.result-changes .result-body :deep(th:first-child),
.result-changes .result-body :deep(td:first-child) {
  width: 32%;
}

.result-changes .result-body :deep(th:last-child),
.result-changes .result-body :deep(td:last-child) {
  width: 68%;
}

.result-changes .result-body :deep(th),
.result-changes .result-body :deep(td) {
  min-width: 0;
  border: 1px solid var(--rule);
  padding: 8px 12px;
  overflow-wrap: anywhere;
  text-align: left;
  vertical-align: top;
  white-space: normal;
  word-break: break-word;
}

.result-changes .result-body :deep(th) {
  background: rgba(255, 255, 255, 0.05);
  color: var(--ink);
  font-weight: 600;
}

.result-body :deep(pre) {
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid var(--rule);
  border-radius: 10px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 0 0 14px;
}

.result-body :deep(code) {
  font-family: var(--mono);
  font-size: 13px;
  color: #e8e2d5;
}

.result-body :deep(pre code) {
  background: none;
  padding: 0;
  white-space: pre;
}

.result-prompt :deep(pre) {
  overflow-x: hidden;
  white-space: pre-wrap;
}

.result-prompt :deep(pre code) {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  word-break: break-word;
}

.result-body :deep(blockquote) {
  margin: 0 0 14px;
  padding: 4px 0 4px 14px;
  border-left: 2px solid rgba(255, 255, 255, 0.25);
  color: var(--muted);
}

.result-body :deep(ul),
.result-body :deep(ol) {
  margin: 0 0 14px;
  padding-left: 22px;
}

.result-body :deep(li) {
  margin: 4px 0;
}

.result-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--rule);
  margin: 20px 0;
}

/* ===== 结果操作 ===== */
.result-actions {
  display: flex;
  gap: 12px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px dashed var(--rule);
}

.action-btn {
  height: 36px;
  min-width: 0;
  padding: 0 20px;
  font-size: 13px;
}

/* AI 免责提示：结果底部 */
.ai-disclaimer {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--muted);
}

/* ===== 入场动画 ===== */
@media (prefers-reduced-motion: no-preference) {
  .opt-layout {
    animation: rise 0.8s 0.16s var(--ease) both;
  }
}
</style>
