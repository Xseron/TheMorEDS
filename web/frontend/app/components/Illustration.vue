<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="rounded-card" :class="{ 'bg-lilac': failed }" :style="{ aspectRatio: ratio }">
    <img v-if="!failed" :src="src" :alt="alt" class="h-full w-full object-contain" loading="lazy" @error="failed = true">
  </div>
</template>

<script setup lang="ts">
defineProps<{ src: string; alt: string; ratio: string }>()
// Пока файла нет, на его месте сиреневая заглушка того же размера
const failed = ref(false)
</script>
