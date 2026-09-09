<script setup lang="ts">
// 模型配置：llm / image-gen / dify 三类配置卡片，保存后回显脱敏 API key
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getModelConfigs, saveModelConfig } from '@/api/admin';
import type { ModelConfig, ModelType } from '@/types';

/** 单个配置表单的本地状态 */
interface ConfigFormState {
  baseUrl: string;
  /** 新密钥输入：留空表示保持原密钥不变 */
  apiKeyInput: string;
  /** 后端回显的脱敏密钥（null 表示未配置） */
  maskedApiKey: string | null;
  models: string[];
  updatedAt: string | null;
}

/** 三类配置的展示信息 */
const TYPE_META: Array<{
  type: ModelType;
  title: string;
  description: string;
  modelsPlaceholder: string;
}> = [
  {
    type: 'llm',
    title: '大语言模型（LLM）',
    description: '对话与分析类工具调用的大模型服务',
    modelsPlaceholder: '输入模型名后回车添加，如 gpt-4o',
  },
  {
    type: 'image-gen',
    title: '生图模型',
    description: '图生图能力（照片 AI 优化），需支持 img2img',
    modelsPlaceholder: '输入模型名后回车添加',
  },
  {
    type: 'dify',
    title: 'Dify 工作流',
    description: '多步骤流程（如简历优化）经本地 Dify 编排',
    modelsPlaceholder: '输入应用标识后回车添加',
  },
];

const loading = ref(true);
const saving = ref<Record<string, boolean>>({});

/** 三类配置各自的表单状态（初始化为空，加载后填充） */
const emptyForm = (): ConfigFormState => ({
  baseUrl: '',
  apiKeyInput: '',
  maskedApiKey: null,
  models: [],
  updatedAt: null,
});

const forms = reactive<Record<ModelType, ConfigFormState>>({
  llm: emptyForm(),
  'image-gen': emptyForm(),
  dify: emptyForm(),
});

onMounted(async () => {
  try {
    const configs = await getModelConfigs();
    fillForms(configs);
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
});

/** 用后端返回的配置填充表单 */
function fillForms(configs: ModelConfig[]) {
  for (const config of configs) {
    const state = forms[config.type];
    state.baseUrl = config.base_url ?? '';
    state.apiKeyInput = '';
    state.maskedApiKey = config.api_key;
    state.models = [...config.models];
    state.updatedAt = config.updated_at;
  }
}

/** 保存某类配置：api_key 留空时不传该字段，保持原密钥不变 */
async function handleSave(type: ModelType) {
  saving.value[type] = true;
  try {
    const state = forms[type];
    const trimmedKey = state.apiKeyInput.trim();
    const saved = await saveModelConfig(type, {
      base_url: state.baseUrl.trim(),
      // 仅在用户输入了新密钥时携带该字段，避免误清空
      ...(trimmedKey ? { api_key: trimmedKey } : {}),
      models: state.models,
    });
    // 保存成功后回显后端脱敏结果
    state.maskedApiKey = saved.api_key;
    state.apiKeyInput = '';
    state.updatedAt = saved.updated_at;
    ElMessage.success('保存成功');
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    saving.value[type] = false;
  }
}
</script>

<template>
  <div v-loading="loading" class="models-view">
    <el-card v-for="meta in TYPE_META" :key="meta.type" shadow="never" class="config-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">{{ meta.title }}</span>
          <span class="card-desc">{{ meta.description }}</span>
        </div>
      </template>

      <el-form label-position="top" class="config-form">
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="Base URL">
              <el-input
                v-model="forms[meta.type].baseUrl"
                placeholder="例如 http://localhost:11434/v1"
                clearable
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item>
              <template #label>
                <span>API Key</span>
                <span v-if="forms[meta.type].maskedApiKey" class="key-masked">
                  当前：{{ forms[meta.type].maskedApiKey }}
                </span>
              </template>
              <el-input
                v-model="forms[meta.type].apiKeyInput"
                type="password"
                placeholder="留空表示不修改当前密钥"
                show-password
                autocomplete="new-password"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="模型列表">
          <el-select
            v-model="forms[meta.type].models"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            :placeholder="meta.modelsPlaceholder"
            class="models-select"
          />
        </el-form-item>
        <div class="form-footer">
          <span class="updated-at">
            {{ forms[meta.type].updatedAt ? `更新于 ${forms[meta.type].updatedAt}` : '尚未配置' }}
          </span>
          <el-button
            type="primary"
            :loading="saving[meta.type]"
            @click="handleSave(meta.type)"
          >
            保存
          </el-button>
        </div>
      </el-form>
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

.key-masked {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}

.models-select {
  width: 100%;
}

.form-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.updated-at {
  font-size: 12px;
  color: #c0c4cc;
}
</style>
