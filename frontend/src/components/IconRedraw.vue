<template>
  <!-- 影像AI重绘图标：画框在右上角缺口，被一颗四角星芒冲出；框内是实心山峦与落日。
       设计意图：缺口 = 「原图被改写」，星芒 = AI。相比满框 + 贴边小星星，缺口让视线有落点，
       小尺寸下也不会糊成一个方块。
       线宽 1.95、实心块用 currentColor，与 Element Plus 图标同族密度；尺寸随 font-size 走。 -->
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    aria-hidden="true"
  >
    <!-- 画框：顶边中点起笔 → 左侧 → 底部 → 右边上行，停在星芒缺口处 -->
    <path
      d="M10.7 6.6H7A4.4 4.4 0 0 0 2.6 11v7a4.4 4.4 0 0 0 4.4 4.4h7A4.4 4.4 0 0 0 18.4 18v-3.6"
      stroke="currentColor"
      stroke-width="1.95"
      stroke-linecap="round"
    />
    <!-- 框内景：双峰山峦（实心，20px 下仍能成剪影） -->
    <path d="M4.7 20.1 8.7 14.2l2.3 2.9 1.9-2.3 3.1 5.3z" fill="currentColor" />
    <!-- 落日 -->
    <circle cx="7.6" cy="11.3" r="1.18" fill="currentColor" />
    <!-- 主星芒：从缺口向外张开，四臂内凹弧比直线星更柔 -->
    <path
      d="M18.2 0.3Q19.064 4.836 23.6 5.7Q19.064 6.564 18.2 11.1Q17.336 6.564 12.8 5.7Q17.336 4.836 18.2 0.3Z"
      fill="currentColor"
    />
    <!-- 副星点：平衡左上角留白，让「AI 感」不止一处 -->
    <path
      d="M10.6 1.1Q10.856 2.444 12.2 2.7Q10.856 2.956 10.6 4.3Q10.344 2.956 9 2.7Q10.344 2.444 10.6 1.1Z"
      fill="currentColor"
    />
  </svg>
</template>
