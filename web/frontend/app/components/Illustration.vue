<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="rounded-card" :class="{ 'bg-lilac': failed }" :style="{ aspectRatio: ratio }">
    <img v-if="!failed" :src="src" :alt="alt" class="h-full w-full object-contain" :loading="loading" :fetchpriority="loading === 'eager' ? 'high' : undefined" @error="failed = true">
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ src: string; alt: string; ratio: string; loading?: 'lazy' | 'eager' }>(), { loading: 'lazy' })
// Пока файла нет, на его месте сиреневая заглушка того же размера
const failed = ref(false)
</script>
