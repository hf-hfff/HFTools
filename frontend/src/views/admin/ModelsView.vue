<script setup lang="ts">
// 模型配置（v2）：OpenAI 单一配置，包含默认模型、生图模型、推理强度与上游模型拉取
// 设计要点：不在保存前做任何上游校验；拉取结果只存在当前页面内存，不缓存
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchUpstreamModels, getModelConfig, saveModelConfig } from '@/api/admin';
import type { ModelConfig, ReasoningEffort, UpstreamModel } from '@/types';

/** 生图模型默认值（仅用于占位文案，实际默认值由后端决定） */
const DEFAULT_IMAGE_MODEL_HINT = 'gpt-image-2';

/** 推理强度选项 */
const EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

/** 表单状态 */
const form = reactive({
  baseUrl: '',
  apiKeyInput: '',
  maskedApiKey: null as string | null,
  defaultModel: '',
  imageModel: '',
  reasoningEffort: 'medium' as ReasoningEffort,
  updatedAt: null as string | null,
});

const loading = ref(true);
const saving = ref(false);
const fetching = ref(false);
/** 上游模型：仅当前页面内存，刷新即清空 */
const upstreamModels = ref<UpstreamModel[]>([]);
const fetchedAt = ref<string | null>(null);
const keyword = ref('');
/** 已保存的 Base URL：用于判断保存后是否需要清空过期列表 */
const savedBaseUrl = ref('');
/** 表单快照：用于判断是否有未保存改动 */
const snapshot = ref('');

/** 表单可比较值（含未保存的新 key，避免用旧凭据拉取） */
function currentValues(): string {
  return JSON.stringify({
    baseUrl: form.baseUrl.trim(),
    apiKeyInput: form.apiKeyInput.trim(),
    defaultModel: form.defaultModel.trim(),
    imageModel: form.imageModel.trim(),
    reasoningEffort: form.reasoningEffort,
  });
}

const dirty = computed(() => currentValues() !== snapshot.value);

const filteredModels = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return kw
    ? upstreamModels.value.filter((item) => item.id.toLowerCase().includes(kw))
    : upstreamModels.value;
});

/** 拉取前的可用性原因（为空表示可拉取） */
const fetchBlockedReason = computed(() => {
  if (!form.baseUrl.trim() || !form.maskedApiKey) return '请先保存 Base URL 与 API Key';
  if (dirty.value) return '请先保存当前修改，再拉取模型';
  return '';
});

onMounted(async () => {
  try {
    applyConfig(await getModelConfig());
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loading.value = false;
    snapshot.value = currentValues();
  }
});

/** 用后端配置填充表单 */
function applyConfig(config: ModelConfig) {
  form.baseUrl = config.base_url ?? '';
  form.apiKeyInput = '';
  form.maskedApiKey = config.api_key;
  form.defaultModel = config.default_model ?? '';
  form.imageModel = config.image_model ?? '';
  form.reasoningEffort = config.reasoning_effort;
  form.updatedAt = config.updated_at;
  savedBaseUrl.value = config.base_url ?? '';
}

async function handleSave() {
  saving.value = true;
  try {
    const trimmedKey = form.apiKeyInput.trim();
    const saved = await saveModelConfig({
      base_url: form.baseUrl.trim(),
      // 仅在用户输入了新密钥时携带，避免误清空
      ...(trimmedKey ? { api_key: trimmedKey } : {}),
      default_model: form.defaultModel.trim(),
      image_model: form.imageModel.trim(),
      reasoning_effort: form.reasoningEffort,
    });
    const baseUrlChanged = (saved.base_url ?? '') !== savedBaseUrl.value;
    applyConfig(saved);
    snapshot.value = currentValues();
    // Base URL 变更后旧列表已失效（列表本身不缓存，清空避免误选）
    if (baseUrlChanged) {
      upstreamModels.value = [];
      fetchedAt.value = null;
    }
    ElMessage.success('保存成功');
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    saving.value = false;
  }
}

async function handleFetchModels() {
  const reason = fetchBlockedReason.value;
  if (reason) {
    ElMessage.warning(reason);
    return;
  }
  fetching.value = true;
  try {
    const result = await fetchUpstreamModels();
    upstreamModels.value = result.models;
    fetchedAt.value = result.fetched_at;
    keyword.value = '';
    if (!result.models.length) {
      ElMessage.warning('上游未返回可用模型');
    } else {
      ElMessage.success(`已拉取 ${result.total} 个模型`);
    }
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    fetching.value = false;
  }
}

/** 复制文本：优先 clipboard，失败降级 execCommand；label 用于在提示里指明复制了什么 */
async function copyText(text: string, label?: string) {
  const done = label ? `已复制 ${label}` : '已复制';
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(done);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (ok) ElMessage.success(done);
    else ElMessage.error('复制失败，请手动选择复制');
  }
}

function copyAll() {
  if (!upstreamModels.value.length) return;
  void copyText(upstreamModels.value.map((item) => item.id).join('\n'));
}

/** 点击标签复制模型 id */
function handleTagClick(item: UpstreamModel) {
  void copyText(item.id, item.id);
}

/** 类型标签文案与颜色 */
const KIND_META: Record<UpstreamModel['kind'], { label: string; type: 'primary' | 'success' | 'info' }> = {
  image: { label: '生图', type: 'success' },
  chat: { label: '对话', type: 'primary' },
  other: { label: '其它', type: 'info' },
};

/** 图例展示顺序 */
const KIND_ORDER: Array<UpstreamModel['kind']> = ['chat', 'image', 'other'];

/** 时间展示（本地时间，失败时回退原文） */
function formatTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <div v-loading="loading" class="models-view">
    <el-card shadow="never" class="config-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">模型配置</span>
          <span class="card-desc">OpenAI 单一配置，覆盖全部 AI 工具调用</span>
        </div>
      </template>

      <el-alert type="info" :closable="false" show-icon class="requirement-notice">
        <template #title>当前配置要求（系统不做保存前校验，请自行确认）</template>
        <div class="notice-body">
          <p>保存前请确认以下条件，系统不会代为验证，也不会在保存时发起任何请求。</p>
          <ol>
            <li>
              仅支持 OpenAI 兼容接口，需同时提供 <code>/v1/chat/completions</code> 与
              <code>/v1/responses</code>
            </li>
            <li>默认模型需支持多模态图片输入（照片点评、照片优化分析），并能作为 Responses 主模型调用图片工具</li>
            <li>
              生图模型须为上游实际可用的图像模型（以拉取列表为准，如
              <code>gpt-image-2</code> / <code>gpt-image-2.5-*</code>）；留空按
              {{ DEFAULT_IMAGE_MODEL_HINT }} 出图，填了密钥不支持的模型会导致照片 AI 优化失败
            </li>
            <li>推理强度仅对推理模型（o1 / o3 / o4 / gpt-5 系列）生效，其他模型会自动忽略该参数</li>
            <li>API Key 需具备上述接口的权限与额度；使用中转地址时请自行确认其兼容性与模型支持情况</li>
            <li>保存后到对应工具页发起一次真实调用，失败信息会指向具体原因</li>
          </ol>
        </div>
      </el-alert>

      <el-form label-position="top" class="config-form">
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="Base URL">
              <el-input v-model="form.baseUrl" placeholder="https://api.openai.com/v1" clearable />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item>
              <template #label>
                <span>API Key</span>
                <span v-if="form.maskedApiKey" class="key-masked">当前：{{ form.maskedApiKey }}</span>
              </template>
              <el-input
                v-model="form.apiKeyInput"
                type="password"
                placeholder="留空表示不修改当前密钥"
                show-password
                autocomplete="new-password"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="24">
          <el-col :span="9">
            <el-form-item>
              <template #label>
                <span>默认模型</span>
                <span class="field-hint">手动填写，可从下方标签复制粘贴</span>
              </template>
              <el-input
                v-model="form.defaultModel"
                placeholder="对话与照片分析使用，如 gpt-4o"
                clearable
              />
            </el-form-item>
          </el-col>
          <el-col :span="9">
            <el-form-item>
              <template #label>
                <span>生图模型</span>
                <span class="field-hint">留空按 {{ DEFAULT_IMAGE_MODEL_HINT }}</span>
              </template>
              <el-input
                v-model="form.imageModel"
                :placeholder="`留空使用 ${DEFAULT_IMAGE_MODEL_HINT}`"
                clearable
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="推理强度">
              <el-radio-group v-model="form.reasoningEffort">
                <el-radio-button v-for="item in EFFORT_OPTIONS" :key="item.value" :value="item.value">
                  {{ item.label }}
                </el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>

        <div class="form-footer">
          <span class="updated-at">
            {{ form.updatedAt ? `更新于 ${formatTime(form.updatedAt)}` : '尚未配置' }}
          </span>
          <div class="footer-actions">
            <el-tooltip
              :content="fetchBlockedReason || '从上游拉取可用模型，仅本次页面有效'"
              placement="top"
            >
              <el-button :loading="fetching" @click="handleFetchModels">拉取模型</el-button>
            </el-tooltip>
            <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
          </div>
        </div>
      </el-form>
    </el-card>

    <el-card v-if="upstreamModels.length" shadow="never" class="models-panel">
      <template #header>
        <div class="panel-header">
          <div class="panel-title">
            上游模型
            <span class="panel-count">{{ upstreamModels.length }}</span>
            <span v-if="fetchedAt" class="panel-time">拉取于 {{ formatTime(fetchedAt) }}</span>
          </div>
          <div class="panel-actions">
            <el-input
              v-model="keyword"
              placeholder="搜索模型"
              clearable
              size="small"
              class="search-input"
            />
            <el-button size="small" @click="copyAll">复制全部</el-button>
          </div>
        </div>
      </template>

      <div class="tag-legend">
        <el-tag
          v-for="kind in KIND_ORDER"
          :key="kind"
          :type="KIND_META[kind].type"
          size="small"
          effect="plain"
        >
          {{ KIND_META[kind].label }}
        </el-tag>
        <span class="legend-text">
          标签颜色表示类型；点击任意标签即复制模型名，粘贴到上方字段即可。列表仅本次页面有效，刷新后需重新拉取。
        </span>
      </div>

      <div class="model-tags">
        <el-tooltip
          v-for="item in filteredModels"
          :key="item.id"
          :content="`${KIND_META[item.kind].label}模型 · 点击复制`"
          placement="top"
          :show-after="300"
        >
          <el-tag
            :type="KIND_META[item.kind].type"
            size="large"
            effect="plain"
            class="model-tag"
            @click="handleTagClick(item)"
          >
            {{ item.id }}
          </el-tag>
        </el-tooltip>
        <span v-if="!filteredModels.length" class="model-empty">没有匹配的模型</span>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.models-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.card-title {
  font-weight: 600;
}

.card-desc {
  font-size: 12px;
  color: #909399;
}

.requirement-notice {
  margin-bottom: 20px;
}

.notice-body {
  font-size: 12px;
  line-height: 1.7;
}

.notice-body p {
  margin: 4px 0;
}

.notice-body ol {
  margin: 6px 0 0;
  padding-left: 18px;
}

.notice-body code {
  padding: 0 4px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 3px;
}

.key-masked,
.field-hint {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: #909399;
}

.form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.footer-actions {
  display: flex;
  gap: 12px;
}

.updated-at {
  font-size: 12px;
  color: #c0c4cc;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.panel-title {
  font-weight: 600;
}

.panel-count {
  margin-left: 8px;
  font-weight: 400;
  color: #409eff;
}

.panel-time {
  margin-left: 12px;
  font-size: 12px;
  font-weight: 400;
  color: #909399;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-input {
  width: 200px;
}

.tag-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.legend-text {
  font-size: 12px;
  color: #909399;
}

.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 340px;
  overflow-y: auto;
  padding: 4px 2px;
}

.model-tag {
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  transition: transform 0.12s ease;
}

.model-tag:hover {
  transform: translateY(-1px);
}

.model-tag:active {
  transform: translateY(0);
}

.model-empty {
  padding: 8px 2px;
  font-size: 13px;
  color: #909399;
}
</style>
