<template>
  <div class="flex min-h-screen flex-col">
    <header>
      <!-- На телефоне ссылки уходят во вторую строку, кошелёк остаётся справа от логотипа -->
      <div class="container-page flex flex-wrap items-center gap-x-10 gap-y-2 py-4 sm:h-[72px] sm:flex-nowrap sm:py-0">
        <NuxtLink to="/" class="flex items-center gap-2.5 no-underline hover:no-underline">
          <img src="/img/mark.png" alt="" width="36" height="36">
          <span class="text-[20px] font-extrabold tracking-tight text-ink">MOR</span>
        </NuxtLink>
        <nav class="order-last flex w-full gap-7 sm:order-none sm:w-auto">
          <NuxtLink v-for="l in links" :key="l.to" :to="l.to" class="text-[15px] font-bold text-ink no-underline hover:text-violet hover:no-underline" exact-active-class="!text-violet">{{ l.text }}</NuxtLink>
        </nav>
        <div class="ml-auto">
          <ClientOnly><WalletButton /></ClientOnly>
        </div>
      </div>
    </header>
    <main class="container-page flex-1 py-12">
      <NuxtPage />
    </main>
    <footer class="border-t border-line">
      <div class="container-page note space-y-1 py-8">
        <p class="max-w-[72ch]">Devnet demo. The certificate authority and attestor here use public test keys, so anyone can mint such seals. This shows the mechanism, not trust.</p>
        <p>RPC: <span class="font-mono text-[14px]">{{ rpcUrl }}</span></p>
        <p>Contact: Telegram <a href="https://t.me/dtorossyan" target="_blank" rel="noopener">@dtorossyan</a>, <a href="https://t.me/ablStartup" target="_blank" rel="noopener">@ablStartup</a></p>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
const rpcUrl = useRuntimeConfig().public.rpcUrl
const links = [{ to: '/', text: 'Lookup' }, { to: '/seal', text: 'Seal' }, { to: '/transfer', text: 'Transfer' }]
</script>
