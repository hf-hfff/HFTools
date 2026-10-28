<script setup lang="ts">
// 工具图标：DB 的 icon 字段存图标名（kebab-case），此处映射为 Element Plus 线性图标
// 线性单色风格，颜色随 currentColor，适配深色电影风 / 管理端浅色两套主题；未知图标回退 Grid
import { computed, markRaw, type Component } from 'vue';
import IconRedraw from '@/components/IconRedraw.vue';
import {
  Camera,
  MagicStick,
  Suitcase,
  Briefcase,
  Reading,
  EditPen,
  Document,
  Picture,
  VideoCamera,
  Cpu,
  SetUp,
  TrendCharts,
  Tickets,
  DocumentChecked,
  OfficeBuilding,
  Promotion,
  Message,
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
  document: markRaw(Document),
  image: markRaw(Picture),
  /** 影像 AI 重绘：自绘图标，EP 的 Picture 在 20px 下过于稀疏 */
  redraw: markRaw(IconRedraw),
  'video-camera': markRaw(VideoCamera),
  code: markRaw(SetUp),
  cpu: markRaw(Cpu),
  'trend-charts': markRaw(TrendCharts),
  tickets: markRaw(Tickets),
  'document-checked': markRaw(DocumentChecked),
  'office-building': markRaw(OfficeBuilding),
  briefcase: markRaw(Briefcase),
  promotion: markRaw(Promotion),
  message: markRaw(Message),
};

const icon = computed(() => REGISTRY[props.name] ?? markRaw(Grid));
</script>

<template>
  <el-icon><component :is="icon" /></el-icon>
</template>
