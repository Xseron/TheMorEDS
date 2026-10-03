<template>
  <div style="width: 1200px; height: 630px; display: flex; flex-direction: row; align-items: stretch; background: #FFFFFF; color: #292B3C; padding: 64px; font-family: 'Manrope';">
    <div style="display: flex; flex-direction: column; justify-content: space-between; flex: 1; padding-right: 48px;">
      <div style="display: flex; flex-direction: row; align-items: center; font-size: 28px; font-weight: 800; letter-spacing: -0.01em;">
        <img :src="mark" width="44" height="44" style="margin-right: 14px;">
        <span>MOR</span>
      </div>
      <div style="display: flex; flex-direction: column;">
        <div style="font-size: 60px; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em;">{{ title }}</div>
        <div style="font-size: 28px; font-weight: 500; line-height: 1.35; margin-top: 24px; color: #5B6070; max-width: 640px;">{{ description }}</div>
      </div>
      <div style="font-size: 22px; font-weight: 700; color: #6D28D9;">Solana devnet demo</div>
    </div>
    <div style="display: flex; align-items: center; justify-content: center; width: 360px; border-radius: 32px; background: #EDE7F7;">
      <img :src="mark" width="220" height="220">
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; description: string }>()
const mark = '/img/mark.svg'
</script>
