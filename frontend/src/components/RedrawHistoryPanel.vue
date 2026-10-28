<script setup lang="ts">
// 重绘历史：原图 / 结果图 / 提示词 的倒序分页列表，支持删除单条与清空
// 图片为同源 URL，el-image 自带点击放大与懒加载，不额外做缩略图服务
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { clearHistory, deleteHistory, listHistory, type HistoryItem } from '@/api/redraw';

const props = defineProps<{
  /** 每次生成成功 +1，用于触发重新拉取 */
  refreshKey: number;
}>();

const emit = defineEmits<{
  (e: 'reuse', prompt: string): void;
}>();

const PAGE_SIZE = 20;

const items = ref<HistoryItem[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);

const empty = computed(() => !loading.value && items.value.length === 0);

/** 时间：本地化短格式（历史记录少，直接格式化不引日期库） */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function load() {
  loading.value = true;
  try {
    const data = await listHistory(page.value, PAGE_SIZE);
    items.value = data.items;
    total.value = data.total;
    // 删掉最后一页的最后一条后回退一页，避免停在空页
    if (items.value.length === 0 && page.value > 1) {
      page.value -= 1;
      await load();
    }
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.refreshKey,
  () => {
    page.value = 1;
    void load();
  },
  { immediate: true },
);

watch(page, () => void load());

async function removeOne(item: HistoryItem) {
  try {
    await ElMessageBox.confirm('删除该记录会同时删除本机保存的原图与结果图，不可恢复。', '删除记录', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await deleteHistory(item.id);
    ElMessage.success('已删除');
    await load();
  } catch {
    // 错误提示已由拦截器统一处理
  }
}

async function clearAll() {
  if (total.value === 0) return;
  try {
    await ElMessageBox.confirm(
      `将清空全部 ${total.value} 条历史记录，并删除对应的图片文件，不可恢复。`,
      '清空历史',
      { confirmButtonText: '全部清空', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    const removed = await clearHistory();
    ElMessage.success(`已清空 ${removed} 条记录`);
    page.value = 1;
    await load();
  } catch {
    // 错误提示已由拦截器统一处理
  }
}
</script>

<template>
  <section class="history glass">
    <header class="hist-head">
      <div>
        <p class="eyebrow">History</p>
        <h2 class="hist-title">历史记录<span v-if="total" class="count">{{ total }}</span></h2>
      </div>
      <div class="hist-actions">
        <button class="mini-btn" type="button" :disabled="loading" @click="load">刷新</button>
        <button class="mini-btn danger" type="button" :disabled="total === 0" @click="clearAll">
          清空
        </button>
      </div>
    </header>

    <p v-if="loading && items.length === 0" class="state">加载中…</p>
    <p v-else-if="empty" class="state">
      还没有历史记录。生成过一次后，原图、结果图与提示词都会保存在这里。
    </p>

    <div v-else class="grid">
      <article v-for="item in items" :key="item.id" class="row">
        <div class="pairs">
          <el-image
            :src="item.source_url"
            :preview-src-list="[item.source_url, item.result_url]"
            :initial-index="0"
            fit="cover"
            preview-teleported
            loading="lazy"
            class="pair-img"
          />
          <el-image
            :src="item.result_url"
            :preview-src-list="[item.source_url, item.result_url]"
            :initial-index="1"
            fit="cover"
            preview-teleported
            loading="lazy"
            class="pair-img"
          />
        </div>
        <div class="row-body">
          <p class="row-time">{{ formatTime(item.created_at) }}</p>
          <p class="row-prompt" :title="item.prompt">{{ item.prompt }}</p>
          <div class="row-actions">
            <button class="text-btn" type="button" @click="emit('reuse', item.prompt)">
              用此提示词
            </button>
            <button class="text-btn danger" type="button" @click="removeOne(item)">删除</button>
          </div>
        </div>
      </article>
    </div>

    <div v-if="total > PAGE_SIZE" class="pager">
      <el-pagination
        v-model:current-page="page"
        :page-size="PAGE_SIZE"
        :total="total"
        layout="prev, pager, next"
        background
        small
      />
    </div>

    <p class="hist-note">
      历史记录保存在本机，所有能访问本服务的人都能查看；包含个人内容的图片请及时删除。
    </p>
  </section>
</template>

<style scoped>
.history {
  margin-top: 22px;
  padding: 22px;
}

.hist-head {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 18px;
}

.eyebrow {
  margin: 0 0 4px;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--strip);
}

.hist-title {
  margin: 0;
  font-size: 19px;
  font-weight: 300;
  color: var(--ink);
}

.count {
  margin-left: 10px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--strip);
}

.hist-actions {
  margin-left: auto;
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
}

.mini-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.mini-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mini-btn.danger {
  color: var(--danger-soft);
  border-color: rgba(242, 184, 181, 0.3);
}

.state {
  margin: 28px 0;
  font-size: 13px;
  color: var(--strip);
}

.grid {
  display: grid;
  gap: 12px;
}

.row {
  display: grid;
  grid-template-columns: 190px 1fr;
  gap: 16px;
  padding: 12px;
  border: 1px solid var(--rule);
  border-radius: 12px;
  background: var(--bg2);
}

@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
  }
}

.pairs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.pair-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 8px;
  background: #000;
  border: 1px solid var(--rule);
}

.row-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.row-time {
  margin: 0 0 6px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--strip);
}

.row-prompt {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.row-actions {
  margin-top: auto;
  padding-top: 10px;
  display: flex;
  gap: 14px;
}

.text-btn {
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 12px;
  color: var(--nav);
  cursor: pointer;
}

.text-btn:hover {
  color: var(--ink);
}

.text-btn.danger {
  margin-left: auto;
  color: #d98c88;
}

.pager {
  display: flex;
  justify-content: center;
  margin-top: 18px;
}

.hist-note {
  margin: 16px 0 0;
  font-size: 11.5px;
  color: var(--ink-3);
}
</style>
