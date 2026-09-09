<script setup lang="ts">
// 工具管理：全部工具表格 + 启用开关（切换即 PATCH，失败回滚）
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getAllTools, updateToolEnabled } from '@/api/admin';
import { useToolsStore } from '@/stores/tools';
import { CATEGORY_LABELS, type Tool, type ToolCategory } from '@/types';

const toolsStore = useToolsStore();
const tools = ref<Tool[]>([]);
const loading = ref(true);
/** 每个工具的开关请求进行中标记 */
const switching = ref<Record<string, boolean>>({});

onMounted(async () => {
  try {
    tools.value = await getAllTools();
  } catch {
    // 错误提示已由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
});

/** 分类转中文名，未知分类原样展示 */
function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as ToolCategory] ?? category;
}

/** 状态转文案 */
function statusLabel(status: string): string {
  return status === 'placeholder' ? '开发中' : status;
}

/** 切换启用状态：成功提示并使首页缓存失效；失败回滚开关 */
async function onSwitchChange(tool: Tool, newVal: boolean | string | number) {
  const enabled = Boolean(newVal);
  switching.value[tool.id] = true;
  try {
    await updateToolEnabled(tool.id, enabled);
    tool.enabled = enabled;
    toolsStore.invalidate(); // 用户端首页需重新拉取
    ElMessage.success(`已${enabled ? '启用' : '禁用'}「${tool.name}」`);
  } catch {
    // 请求失败：回滚开关状态，提示已由拦截器统一处理
    tool.enabled = !enabled;
  } finally {
    switching.value[tool.id] = false;
  }
}
</script>

<template>
  <div class="tools-view">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>工具管理</span>
          <span class="header-tip">关闭开关后，用户端首页将不再展示该工具</span>
        </div>
      </template>

      <el-table v-loading="loading" :data="tools" stripe>
        <el-table-column label="图标" width="64">
          <template #default="{ row }">
            <span class="tool-icon">{{ row.icon }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="工具名称" min-width="140" />
        <el-table-column label="分类" width="100">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ categoryLabel(row.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'placeholder' ? 'info' : 'success'">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="排序" prop="sort_order" width="70" />
        <el-table-column label="启用" width="110" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              :loading="switching[row.id]"
              @change="(val: string | number | boolean) => onSwitchChange(row, val)"
            />
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-tip {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}

.tool-icon {
  font-size: 20px;
}
</style>
