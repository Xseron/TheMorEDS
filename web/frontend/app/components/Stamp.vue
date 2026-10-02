<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <svg v-if="kind === 'registry'" :width="size" :height="size" viewBox="0 0 160 160" class="stamp" role="img" aria-label="Registry seal: valid">
    <defs>
      <filter :id="`ink-${uid}`"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" /></filter>
      <path :id="`ring-${uid}`" d="M80,26 a54,54 0 1,1 -0.01,0" />
    </defs>
    <g :filter="`url(#ink-${uid})`" fill="none" stroke="#6D28D9" stroke-width="3">
      <path :d="scallop" />
      <circle cx="80" cy="80" r="46" />
      <path d="M50,108 V52 l30,27 30,-27 V108 h-12 V78 l-18,16 -18,-16 V108 Z" fill="#6D28D9" stroke="none" />
    </g>
    <text :filter="`url(#ink-${uid})`" fill="#6D28D9" font-size="10.5" font-weight="600" letter-spacing="1.6" font-family="'STIX Two Text', serif">
      <textPath :href="`#ring-${uid}`" startOffset="0">REGISTRY OF SEALS ★ MOR ★ SOLANA DEVNET ★</textPath>
    </text>
  </svg>
  <svg v-else :width="size * 1.4" :height="size * 0.45" viewBox="0 0 224 72" class="stamp" role="img" :aria-label="`Stamp: ${label}`">
    <defs><filter :id="`ink-${uid}`"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" /></filter></defs>
    <g :filter="`url(#ink-${uid})`" :stroke="color" fill="none" stroke-width="3">
      <rect x="4" y="4" width="216" height="64" />
      <rect x="11" y="11" width="202" height="50" stroke-width="1.5" />
    </g>
    <text :filter="`url(#ink-${uid})`" x="112" y="46" text-anchor="middle" :fill="color" font-size="24" font-weight="600" letter-spacing="3" font-family="'STIX Two Text', serif">{{ label }}</text>
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ kind: 'registry' | 'expired' | 'refused'; label?: string; size?: number }>(), { label: '', size: 160 })
const uid = useId()
const color = computed(() => (props.kind === 'expired' ? '#5F5F5C' : '#B42318'))
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
