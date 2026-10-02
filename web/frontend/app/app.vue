<template>
  <div class="flex min-h-screen flex-col">
    <header class="border-b border-rule">
      <div class="container-page flex h-16 items-center gap-6">
        <NuxtLink to="/" class="flex items-center gap-2 no-underline hover:no-underline">
          <img src="/logo.png" alt="MOR" width="40" height="40">
        </NuxtLink>
        <nav class="flex gap-5 text-[15px]">
          <NuxtLink to="/">Lookup</NuxtLink>
          <NuxtLink to="/seal">Seal</NuxtLink>
          <NuxtLink to="/transfer">Transfer</NuxtLink>
        </nav>
        <div class="ml-auto">
          <ClientOnly><WalletButton /></ClientOnly>
        </div>
      </div>
    </header>
    <main class="container-page flex-1 py-10">
      <NuxtPage />
    </main>
    <footer class="border-t border-rule">
      <div class="container-page note py-6">
        Devnet. The certificate authority and the attestor here are test ones, their keys are in the repository,
        so anyone can mint such seals. This shows the mechanism, not trust.
        RPC: <span class="font-mono">{{ rpcUrl }}</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
const rpcUrl = useRuntimeConfig().public.rpcUrl
</script>
