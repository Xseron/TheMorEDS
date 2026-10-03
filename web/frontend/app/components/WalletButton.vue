<template>
  <details ref="root" class="relative">
    <summary class="btn cursor-pointer list-none">
      <template v-if="wallet">
        <img v-if="wallet.icon" :src="wallet.icon" alt="" width="16" height="16" class="mr-2">
        <span class="font-mono font-medium">{{ shortAddress(wallet.address) }}</span>
      </template>
      <template v-else>Connect wallet</template>
    </summary>
    <div class="absolute right-0 z-10 mt-2 w-72 rounded-card bg-paper p-2 shadow-none ring-1 ring-line">
      <p v-if="wallet" class="px-3 py-2 text-[15px]">{{ wallet.name }}<br><span class="font-mono text-[13px] [overflow-wrap:anywhere]">{{ wallet.address }}</span></p>
      <button v-if="wallet" class="block w-full rounded-control px-3 py-2 text-left text-[15px] font-bold hover:bg-lilac-soft" @click="pick(null)">Disconnect</button>
      <template v-else>
        <p v-if="options.length === 1" class="note px-3 py-2">No wallet extension found</p>
        <button v-for="o in options" :key="o.name" class="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-[15px] font-bold hover:bg-lilac-soft" :disabled="connecting" @click="pick(o.name)">
          <img v-if="o.icon" :src="o.icon" alt="" width="20" height="20">
          <Icon v-else name="ph:wallet" size="20" class="text-violet" />
          <span>{{ o.name }}<span v-if="o.note" class="note block font-medium">{{ o.note }}</span></span>
        </button>
      </template>
      <p v-if="error" class="px-3 py-2 text-[15px] text-refusal">{{ error }}</p>
    </div>
  </details>
</template>

<script setup lang="ts">
import { shortAddress } from '~/utils/registry'

const { options, wallet, connecting, connect, disconnect, autoConnect } = useWallet()
const root = ref<HTMLDetailsElement>()
const error = ref('')

async function pick(name: string | null) {
  error.value = ''
  try {
    if (name) await connect(name)
    else disconnect()
    root.value?.removeAttribute('open')
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(() => {
  autoConnect()
  document.addEventListener('click', (ev) => {
    if (root.value?.open && !root.value.contains(ev.target as Node)) root.value.removeAttribute('open')
  })
})
</script>
