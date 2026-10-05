<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <svg :width="size" :height="size" viewBox="0 0 160 160" class="stamp" role="img" :aria-label="tone === 'muted' ? 'Registry seal: expired' : 'Registry seal: valid'">
    <defs>
      <filter :id="`ink-${uid}`"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" /></filter>
      <path :id="`ring-${uid}`" d="M80,26 a54,54 0 1,1 -0.01,0" />
    </defs>
    <g :filter="`url(#ink-${uid})`" fill="none" :stroke="ink" stroke-width="3">
      <path :d="scallop" />
      <circle cx="80" cy="80" r="46" />
      <path d="M50,108 V52 l30,27 30,-27 V108 h-12 V78 l-18,16 -18,-16 V108 Z" :fill="ink" stroke="none" />
    </g>
    <text :filter="`url(#ink-${uid})`" :fill="ink" font-size="10.5" font-weight="800" letter-spacing="2.1" font-family="Manrope, sans-serif">
      <textPath :href="`#ring-${uid}`" startOffset="0">REGISTRY OF SEALS ★ MOR ★ SOLANA DEVNET ★</textPath>
    </text>
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ tone?: 'violet' | 'muted'; size?: number }>(), { tone: 'violet', size: 160 })
const uid = useId()
const ink = computed(() => (props.tone === 'muted' ? '#5B6070' : '#6D28D9'))
// Кромка с 12 волнами, как у логотипа
const scallop = computed(() => {
  const pts: string[] = []
  for (let i = 0; i <= 240; i++) {
    const t = (i / 240) * 2 * Math.PI
    const r = 70 + 6 * (0.5 + 0.5 * Math.cos(12 * t))
    pts.push(`${(80 + r * Math.cos(t)).toFixed(2)},${(80 + r * Math.sin(t)).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
})
</script>

<style scoped>
.stamp { mix-blend-mode: multiply; opacity: 0.92; animation: press 280ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes press { from { transform: scale(1.25); opacity: 0; } to { transform: scale(1); opacity: 0.92; } }
</style>
