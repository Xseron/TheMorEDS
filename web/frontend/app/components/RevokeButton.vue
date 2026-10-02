<template>
  <span class="inline-flex flex-wrap items-center gap-2">
    <button class="btn" :disabled="busy" @click="revoke">Revoke seal</button>
    <span v-if="busy" class="note">Revoking…</span>
    <span v-else-if="error" class="text-[15px] text-refusal">{{ error }}</span>
  </span>
</template>

<script setup lang="ts">
import { address as toAddress } from '@solana/kit'
import { describeError } from '~/utils/errors'
import { revokeSealInstruction } from '~/utils/registry'

const props = defineProps<{ address: string; sealPda: string }>()
const emit = defineEmits<{ revoked: [signature: string] }>()
const { ids, send, attestorUrl } = useSolana()
const { wallet } = useWallet()
const { invalidate } = useRegistry()
const busy = ref(false)
const error = ref('')

async function revoke() {
  busy.value = true
  error.value = ''
  try {
    const signer = wallet.value!.address
    const sig = await send([revokeSealInstruction(ids, { signer, address: toAddress(props.address), seal: toAddress(props.sealPda) })])
    invalidate(props.address)
    emit('revoked', sig)
  } catch (e) {
    error.value = describeError(e, { attestorUrl })
  } finally {
    busy.value = false
  }
}
</script>
