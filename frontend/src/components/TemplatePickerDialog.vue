<script setup lang="ts">
// 提示词模板弹窗：卡片列表 + 名称本地检索 + 示例图放大 + 新增/编辑/删除
// 列表接口不返回正文（避免上百条 1 万字正文撑爆响应），选中后再按 id 拉详情
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  addTemplatePreview,
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  removeTemplatePreview,
  updateTemplate,
  type TemplateDetail,
  type TemplateListItem,
  type TemplatePreview,
} from '@/api/redraw';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'select', detail: TemplateDetail): void;
}>();

/** 模板名称 / 正文上限（与后端一致） */
const NAME_MAX = 60;
const BODY_MAX = 10_000;
/** 示例图单张上限 5MB、每模板最多 3 张（与后端一致） */
const PREVIEW_MAX_MB = 5;
const PREVIEW_MAX_COUNT = 3;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const mode = ref<'list' | 'edit'>('list');
const list = ref<TemplateListItem[]>([]);
const loading = ref(false);
const keyword = ref('');
const selectingId = ref<number | null>(null);

/** 编辑表单：id 为 null 表示新建（新建前不能加示例图，文件需挂到模板下） */
const form = ref<{ id: number | null; name: string; body: string; previews: TemplatePreview[] }>({
  id: null,
  name: '',
  body: '',
  previews: [],
});
const saving = ref(false);
const uploading = ref(false);
const previewInput = ref<HTMLInputElement>();

/** 名称本地模糊过滤（≤200 条无性能问题，无需搜索接口） */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return list.value;
  return list.value.filter((item) => item.name.toLowerCase().includes(kw));
});

const formBodyCount = computed(() => form.value.body.trim().length);

/** 打开弹窗时刷新列表 */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    mode.value = 'list';
    keyword.value = '';
    void loadList();
  },
);

async function loadList() {
  loading.value = true;
  try {
    list.value = await listTemplates();
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
}

/** 选用模板：拉详情拿到正文后回传页面 */
async function selectTemplate(item: TemplateListItem) {
  if (selectingId.value !== null) return;
  selectingId.value = item.id;
  try {
    const detail = await getTemplate(item.id);
    emit('select', detail);
    visible.value = false;
  } catch {
    void 0;
  } finally {
    selectingId.value = null;
  }
}

function startCreate() {
  form.value = { id: null, name: '', body: '', previews: [] };
  mode.value = 'edit';
}

async function startEdit(item: TemplateListItem) {
  try {
    const detail = await getTemplate(item.id);
    form.value = {
      id: detail.id,
      name: detail.name,
      body: detail.body,
      previews: detail.previews,
    };
    mode.value = 'edit';
  } catch {
    void 0;
  }
}

/** 保存：新建走 POST，编辑走 PATCH；保存后留在编辑态以便继续补示例图 */
async function save() {
  const name = form.value.name.trim();
  const body = form.value.body.trim();
  if (!name) {
    ElMessage.warning('请填写模板名称');
    return;
  }
  if (name.length > NAME_MAX) {
    ElMessage.warning(`模板名称最多 ${NAME_MAX} 字`);
    return;
  }
  if (!body) {
    ElMessage.warning('模板正文不能为空');
    return;
  }
  if (body.length > BODY_MAX) {
    ElMessage.warning(`模板正文最多 ${BODY_MAX} 字`);
    return;
  }

  const isCreate = form.value.id === null;
  saving.value = true;
  try {
    const detail = isCreate
      ? await createTemplate({ name, body })
      : await updateTemplate(form.value.id as number, { name, body });
    form.value = {
      id: detail.id,
      name: detail.name,
      body: detail.body,
      previews: detail.previews,
    };
    ElMessage.success(isCreate ? '模板已保存，可继续添加示例图' : '模板已更新');
    await loadList();
  } catch {
    // 错误提示已由拦截器统一处理
  } finally {
    saving.value = false;
  }
}

function pickPreview() {
  if (form.value.id === null) {
    ElMessage.warning('请先保存模板，再添加示例图');
    return;
  }
  if (form.value.previews.length >= PREVIEW_MAX_COUNT) {
    ElMessage.warning(`每个模板最多 ${PREVIEW_MAX_COUNT} 张示例图`);
    return;
  }
  previewInput.value?.click();
}

function onPreviewChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!ALLOWED_TYPES.includes(file.type)) {
    ElMessage.warning('示例图仅支持 jpg / png / webp');
    return;
  }
  if (file.size > PREVIEW_MAX_MB * 1024 * 1024) {
    ElMessage.warning(`示例图不能超过 ${PREVIEW_MAX_MB}MB`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => void uploadPreview(String(reader.result));
  reader.readAsDataURL(file);
}

async function uploadPreview(image: string) {
  if (form.value.id === null) return;
  uploading.value = true;
  try {
    const detail = await addTemplatePreview(form.value.id, image);
    form.value.previews = detail.previews;
    await loadList();
    ElMessage.success('示例图已添加');
  } catch {
    // 错误提示已由拦截器统一处理
  } finally {
    uploading.value = false;
  }
}

async function dropPreview(previewId: number) {
  if (form.value.id === null) return;
  try {
    const detail = await removeTemplatePreview(form.value.id, previewId);
    form.value.previews = detail.previews;
    await loadList();
  } catch {
    void 0;
  }
}

async function removeTemplate(item: TemplateListItem) {
  try {
    await ElMessageBox.confirm(
      `删除模板「${item.name}」后，其示例图会被一并清除，且不可恢复。`,
      '删除模板',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return; // 用户取消
  }
  try {
    await deleteTemplate(item.id);
    ElMessage.success('已删除');
    await loadList();
  } catch {
    // 错误提示已由拦截器统一处理
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="redraw-dialog"
    width="min(880px, 92vw)"
    align-center
    append-to-body
    :close-on-click-modal="false"
  >
    <template #header>
      <div class="dlg-head">
        <div>
          <p class="dlg-eyebrow">Prompt Templates</p>
          <h3 class="dlg-title">{{ mode === 'list' ? '选择提示词模板' : form.id === null ? '新建模板' : '编辑模板' }}</h3>
        </div>
        <div class="dlg-head-actions">
          <template v-if="mode === 'list'">
            <el-input
              v-model="keyword"
              class="search"
              placeholder="搜索模板名称"
              clearable
              size="default"
            />
            <button class="pill-btn" type="button" @click="startCreate">新建模板</button>
          </template>
          <button v-else class="pill-btn ghost" type="button" @click="mode = 'list'">
            返回列表
          </button>
        </div>
      </div>
    </template>

    <!-- 列表 -->
    <div v-if="mode === 'list'" class="list-wrap">
      <p v-if="loading" class="state">加载中…</p>
      <el-empty
        v-else-if="list.length === 0"
        description="还没有模板，可直接手动输入提示词，或新建一个模板"
        :image-size="72"
      />
      <el-empty
        v-else-if="filtered.length === 0"
        :description="`没有名称包含「${keyword}」的模板`"
        :image-size="72"
      />

      <div v-else class="cards">
        <article v-for="item in filtered" :key="item.id" class="card">
          <div class="card-media" @click="selectTemplate(item)">
            <el-image
              v-if="item.previews.length"
              :src="item.previews[0].url"
              :preview-src-list="item.previews.map((p) => p.url)"
              :initial-index="0"
              fit="cover"
              preview-teleported
              class="thumb"
            />
            <div v-else class="thumb empty-thumb">无示例图</div>
            <span v-if="item.previews.length" class="thumb-count">
              {{ item.previews.length }} 张
            </span>
          </div>
          <div class="card-body">
            <h4 class="card-name" :title="item.name" @click="selectTemplate(item)">
              {{ item.name }}
            </h4>
            <div class="card-actions">
              <button
                class="text-btn primary"
                type="button"
                :disabled="selectingId === item.id"
                @click="selectTemplate(item)"
              >
                {{ selectingId === item.id ? '读取中…' : '选用' }}
              </button>
              <button class="text-btn" type="button" @click="startEdit(item)">编辑</button>
              <button class="text-btn danger" type="button" @click="removeTemplate(item)">
                删除
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- 编辑 -->
    <div v-else class="edit-wrap">
      <label class="field">
        <span class="field-label">
          模板名称
          <em class="field-note">{{ form.name.trim().length }} / {{ NAME_MAX }}</em>
        </span>
        <el-input v-model="form.name" :maxlength="NAME_MAX" placeholder="例如：赛博朋克夜景" />
      </label>

      <label class="field">
        <span class="field-label">
          提示词正文
          <em class="field-note">{{ formBodyCount }} / {{ BODY_MAX }}</em>
        </span>
        <el-input
          v-model="form.body"
          type="textarea"
          :rows="9"
          resize="vertical"
          placeholder="描述希望重绘出的画面：主体、环境、构图、光线、色彩、材质、风格…"
        />
      </label>

      <div class="field">
        <span class="field-label">
          示例图
          <em class="field-note">{{ form.previews.length }} / {{ PREVIEW_MAX_COUNT }}</em>
        </span>
        <div class="preview-row">
          <div v-for="p in form.previews" :key="p.id" class="preview-item">
            <el-image
              :src="p.url"
              :preview-src-list="form.previews.map((it) => it.url)"
              fit="cover"
              preview-teleported
              class="preview-thumb"
            />
            <button class="preview-del" type="button" title="删除示例图" @click="dropPreview(p.id)">
              ×
            </button>
          </div>
          <button
            v-if="form.previews.length < PREVIEW_MAX_COUNT"
            class="preview-add"
            type="button"
            :disabled="uploading"
            @click="pickPreview"
          >
            {{ uploading ? '上传中…' : '＋ 添加' }}
          </button>
        </div>
        <input ref="previewInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onPreviewChange" />
        <p v-if="form.id === null" class="field-tip">新建模板需先保存，才能添加示例图</p>
      </div>
    </div>

    <template #footer>
      <div class="dlg-foot">
        <span class="foot-note">
          模板改动只影响下次选用，不会改变编辑框里的现有提示词
        </span>
        <div class="foot-actions">
          <button class="pill-btn ghost" type="button" @click="visible = false">关闭</button>
          <button v-if="mode === 'edit'" class="pill-btn" type="button" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存模板' }}
          </button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.dlg-head {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  flex-wrap: wrap;
}

.dlg-eyebrow {
  margin: 0 0 4px;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--strip);
}

.dlg-title {
  margin: 0;
  font-size: 19px;
  font-weight: 400;
  color: var(--ink);
}

.dlg-head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.search {
  width: 200px;
}

.pill-btn {
  height: 34px;
  padding: 0 18px;
  border-radius: 999px;
  border: none;
  background: #fff;
  color: #050505;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.2s var(--ease);
}

.pill-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.pill-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pill-btn.ghost {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: var(--ink);
}

.list-wrap {
  min-height: 220px;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
}

.state {
  margin: 40px 0;
  text-align: center;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--strip);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}

.card {
  border: 1px solid var(--rule);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg3);
  transition: border-color 0.25s var(--ease);
}

.card:hover {
  border-color: rgba(255, 255, 255, 0.24);
}

.card-media {
  position: relative;
  cursor: pointer;
}

.thumb {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #000;
}

.empty-thumb {
  display: grid;
  place-items: center;
  font-family: var(--mono);
  font-size: 11px;
  color: #4c4c50;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
}

.thumb-count {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.66);
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--ink);
}

.card-body {
  padding: 10px 12px 12px;
}

.card-name {
  margin: 0 0 10px;
  font-size: 13.5px;
  font-weight: 400;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.card-actions {
  display: flex;
  gap: 12px;
}

.text-btn {
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 12px;
  color: var(--nav);
  cursor: pointer;
  transition: color 0.2s var(--ease);
}

.text-btn:hover:not(:disabled) {
  color: var(--ink);
}

.text-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.text-btn.primary {
  color: var(--ink);
}

.text-btn.danger {
  margin-left: auto;
  color: #d98c88;
}

.edit-wrap {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 4px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  color: var(--nav);
}

.field-note {
  font-family: var(--mono);
  font-size: 10.5px;
  font-style: normal;
  color: var(--strip);
}

.field-tip {
  margin: 0;
  font-size: 11.5px;
  color: var(--strip);
}

.preview-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.preview-item {
  position: relative;
  width: 104px;
  height: 78px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--rule);
}

.preview-thumb {
  width: 100%;
  height: 100%;
  display: block;
}

.preview-del {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.7);
  color: var(--ink);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.preview-add {
  width: 104px;
  height: 78px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background: transparent;
  color: var(--nav);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.preview-add:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.4);
  color: var(--ink);
}

.dlg-foot {
  display: flex;
  align-items: center;
  gap: 16px;
}

.foot-note {
  flex: 1;
  text-align: left;
  font-size: 11.5px;
  color: var(--strip);
}

.foot-actions {
  display: flex;
  gap: 10px;
}
</style>

<!-- 弹窗容器被 teleport 到 body，深色外观需非 scoped 样式 -->
<style>
.redraw-dialog.el-dialog {
  background: var(--bg2);
  border: 1px solid var(--rule);
  border-radius: 16px;
}

.redraw-dialog .el-dialog__header {
  padding: 20px 22px 14px;
  margin-right: 0;
  border-bottom: 1px solid var(--rule);
}

.redraw-dialog .el-dialog__body {
  padding: 18px 22px;
}

.redraw-dialog .el-dialog__footer {
  padding: 14px 22px 20px;
  border-top: 1px solid var(--rule);
}

.redraw-dialog .el-dialog__headerbtn .el-dialog__close {
  color: var(--nav);
}

.redraw-dialog .el-empty__description p {
  color: var(--strip);
}

/* 深色表单控件（弹窗内容 teleport 到 body，须非 scoped 才稳定命中内部结构） */
.redraw-dialog .el-input__wrapper,
.redraw-dialog .el-textarea__inner {
  background: var(--bg3);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  color: var(--ink);
}

.redraw-dialog .el-input__wrapper:hover,
.redraw-dialog .el-textarea__inner:hover {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.24) inset;
}

.redraw-dialog .el-input__wrapper.is-focus,
.redraw-dialog .el-textarea__inner:focus {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45) inset;
}

.redraw-dialog .el-input__inner,
.redraw-dialog .el-textarea__inner {
  color: var(--ink);
  font-family: inherit;
}

.redraw-dialog .el-input__count,
.redraw-dialog .el-input__count-inner {
  background: transparent;
  color: var(--strip);
}

.redraw-dialog .el-input__inner::placeholder,
.redraw-dialog .el-textarea__inner::placeholder {
  color: #5c5c60;
}
</style>
