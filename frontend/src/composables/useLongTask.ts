import { computed, onUnmounted, ref } from 'vue';

export interface LongTaskStage {
  label: string;
  /** 进入该阶段的最早秒数（时间预估，非后端真实进度）；全部缺省时按 rotateMs 轮播 */
  startS?: number;
}

export interface LongTaskOptions {
  /** 超时上限（秒），仅用于页面展示 */
  timeoutS: number;
  /** 阶段文案：带 startS 时按时间阈值单调推进，否则按 rotateMs 轮播 */
  stages: readonly LongTaskStage[];
  /** 轮播间隔（毫秒），stages 未提供 startS 时生效 */
  rotateMs?: number;
}

/**
 * 长任务等待态：秒数计时 + 阶段推进，卸载自动清理定时器。
 * 单次 POST 无 SSE，阶段只能按时间预估，不冒充后端真实进度。
 */
export function useLongTask(options: LongTaskOptions) {
  const elapsed = ref(0);
  const stage = ref(1);
  const running = ref(false);
  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  let stageTimer: ReturnType<typeof setInterval> | undefined;

  const timed = options.stages.some((s) => s.startS !== undefined);
  const stageLabel = computed(
    () => options.stages[stage.value - 1]?.label ?? options.stages[0]?.label ?? '',
  );

  function advanceByTime() {
    let target = 1;
    for (let i = 0; i < options.stages.length; i++) {
      if (elapsed.value >= (options.stages[i].startS ?? 0)) target = i + 1;
    }
    // Math.max 保证阶段单调只前进，不因预估误差回跳
    stage.value = Math.max(stage.value, target);
  }

  /** 启动等待：initialStage 供「仅重发」场景从中间阶段起步 */
  function start(initialStage = 1) {
    stop();
    running.value = true;
    elapsed.value = 0;
    stage.value = initialStage;
    elapsedTimer = setInterval(() => {
      elapsed.value += 1;
      if (timed) advanceByTime();
    }, 1000);
    if (!timed && options.stages.length > 1) {
      stageTimer = setInterval(() => {
        stage.value = (stage.value % options.stages.length) + 1;
      }, options.rotateMs ?? 2500);
    }
  }

  function stop() {
    clearInterval(elapsedTimer);
    clearInterval(stageTimer);
    elapsedTimer = undefined;
    stageTimer = undefined;
    running.value = false;
  }

  onUnmounted(stop);

  return { elapsed, stage, stageLabel, running, start, stop };
}
