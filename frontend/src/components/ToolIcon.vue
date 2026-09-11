<script setup lang="ts">
// 工具图标：DB 的 icon 字段存图标名（kebab-case），此处映射为 Element Plus 线性图标
// 线性单色风格，颜色随 currentColor，适配深色电影风 / 管理端浅色两套主题；未知图标回退 Grid
import { computed, markRaw, type Component } from 'vue';
import {
  Camera,
  MagicStick,
  Suitcase,
  Reading,
  EditPen,
  Cpu,
  TrendCharts,
  Tickets,
  DocumentChecked,
  OfficeBuilding,
  Grid,
} from '@element-plus/icons-vue';

const props = defineProps<{ name: string }>();

/** 图标名 -> 组件注册表（新增工具在种子数据声明图标名后需在此登记） */
const REGISTRY: Record<string, Component> = {
  camera: markRaw(Camera),
  'magic-stick': markRaw(MagicStick),
  suitcase: markRaw(Suitcase),
  reading: markRaw(Reading),
  'edit-pen': markRaw(EditPen),
  cpu: markRaw(Cpu),
  'trend-charts': markRaw(TrendCharts),
  tickets: markRaw(Tickets),
  'document-checked': markRaw(DocumentChecked),
  'office-building': markRaw(OfficeBuilding),
};

const icon = computed(() => REGISTRY[props.name] ?? markRaw(Grid));
</script>

<template>
  <el-icon><component :is="icon" /></el-icon>
</template>
