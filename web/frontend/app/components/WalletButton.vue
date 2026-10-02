<template>
  <details ref="root" class="relative">
    <summary class="btn list-none cursor-pointer">
      <template v-if="wallet">
        <img v-if="wallet.icon" :src="wallet.icon" alt="" width="16" height="16" class="mr-2 inline-block align-[-3px]">
        <span class="font-mono">{{ shortAddress(wallet.address) }}</span>
      </template>
      <template v-else>Connect wallet</template>
    </summary>
    <div class="absolute right-0 z-10 mt-1 w-72 border border-ink bg-paper p-1">
      <p v-if="wallet" class="px-3 py-2 text-[15px]">{{ wallet.name }}<br><span class="font-mono">{{ wallet.address }}</span></p>
      <button v-if="wallet" class="block w-full px-3 py-2 text-left text-[15px] hover:bg-seal-tint" @click="pick(null)">Disconnect</button>
      <template v-else>
        <p v-if="options.length === 1" class="note px-3 py-2">No wallet extension found</p>
        <button v-for="o in options" :key="o.name" class="flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-seal-tint" :disabled="connecting" @click="pick(o.name)">
          <img v-if="o.icon" :src="o.icon" alt="" width="20" height="20">
          <Icon v-else name="ph:wallet" size="20" />
          <span>{{ o.name }}<span v-if="o.note" class="note block">{{ o.note }}</span></span>
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
