<script setup lang="ts">
// 图片上传：拖拽/点击、类型与大小校验、预览、替换、移除
// 只服务影像 AI 重绘页；照片点评/照片优化页保持原实现不动（避免额外回归）
import { ref } from 'vue';
import { ElMessage } from 'element-plus';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    fileName?: string;
    disabled?: boolean;
    /** 大小上限（MB） */
    maxSizeMb?: number;
  }>(),
  { fileName: '', disabled: false, maxSizeMb: 8 },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'update:fileName', value: string): void;
}>();

/** 允许的图片类型（与后端校验一致） */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const fileInput = ref<HTMLInputElement>();
const dragging = ref(false);

/** 选择/拖入图片：校验类型与大小后转 data URL 预览 */
function acceptFile(file: File | undefined) {
  if (props.disabled || !file) return;
  if (!ALLOWED_TYPES.includes(file.type)) {
    ElMessage.warning('仅支持 jpg / png / webp 图片');
    return;
  }
  if (file.size > props.maxSizeMb * 1024 * 1024) {
    ElMessage.warning(`图片不能超过 ${props.maxSizeMb}MB`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    emit('update:modelValue', String(reader.result));
    emit('update:fileName', file.name);
  };
  reader.readAsDataURL(file);
}

function onFileChange(e: Event) {
  acceptFile((e.target as HTMLInputElement).files?.[0]);
  if (fileInput.value) fileInput.value.value = '';
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  acceptFile(e.dataTransfer?.files?.[0]);
}

function openPicker() {
  if (props.disabled) return;
  fileInput.value?.click();
}

function removeImage() {
  if (props.disabled) return;
  emit('update:modelValue', '');
  emit('update:fileName', '');
}
</script>

<template>
  <div class="uploader">
    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      @change="onFileChange"
    />

    <!-- 空态：点击/拖拽上传 -->
    <div
      v-if="!modelValue"
      class="drop-zone"
      :class="{ dragging, disabled }"
      role="button"
      tabindex="0"
      @click="openPicker"
      @keydown.enter.prevent="openPicker"
      @keydown.space.prevent="openPicker"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <div class="drop-icon">＋</div>
      <p class="drop-title">拖入或点击上传原图</p>
      <p class="drop-hint">jpg / png / webp · 不超过 {{ maxSizeMb }}MB</p>
    </div>

    <!-- 已选：预览 + 替换 + 移除 -->
    <div v-else class="preview">
      <img :src="modelValue" alt="原图预览" class="preview-img" />
      <div class="preview-bar">
        <span class="preview-name" :title="fileName">{{ fileName || '原图' }}</span>
        <div class="preview-actions">
          <button class="mini-btn" type="button" :disabled="disabled" @click="openPicker">
            替换
          </button>
          <button class="mini-btn danger" type="button" :disabled="disabled" @click="removeImage">
            移除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uploader {
  height: 100%;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 300px;
  height: 100%;
  padding: 28px 20px;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.015);
  cursor: pointer;
  transition:
    border-color 0.25s var(--ease),
    background 0.25s var(--ease);
}

.drop-zone:hover,
.drop-zone.dragging {
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.04);
}

.drop-zone.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.drop-icon {
  font-size: 26px;
  font-weight: 200;
  color: var(--nav);
  line-height: 1;
}

.drop-title {
  margin: 10px 0 0;
  font-size: 14px;
  color: var(--ink);
}

.drop-hint {
  margin: 0;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.08em;
  color: var(--strip);
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}

.preview-img {
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  border-radius: 10px;
  background: #000;
  border: 1px solid var(--rule);
}

.preview-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.preview-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--strip);
}

.preview-actions {
  display: flex;
  gap: 8px;
}

.mini-btn {
  height: 30px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.2s var(--ease), opacity 0.2s var(--ease);
}

.mini-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.mini-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mini-btn.danger {
  color: #f2b8b5;
  border-color: rgba(242, 184, 181, 0.3);
}
</style>
