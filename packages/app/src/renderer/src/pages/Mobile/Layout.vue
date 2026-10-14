<template>
  <div class="mobile-watch-layout">
    <header class="mobile-watch-header">
      <n-button
        v-if="
          ['MobilePlayer', 'MobileSessionPlayer', 'MobileStreamerCalendar'].includes(
            String($route.name),
          )
        "
        quaternary
        @click="$router.back()"
        >返回</n-button
      >
      <strong>biliLive-tools</strong>
      <n-button size="small" @click="desktop">电脑版</n-button>
    </header>
    <main
      class="mobile-watch-content"
      :class="{ 'session-content': $route.name === 'MobileSessionPlayer' }"
    >
      <router-view :key="$route.fullPath" />
    </main>
    <nav class="mobile-watch-nav" aria-label="观看导航">
      <router-link to="/mobile" exact-active-class="selected">首页</router-link>
      <router-link to="/mobile/recordings" active-class="selected">录像</router-link>
      <router-link to="/mobile/files" active-class="selected">文件</router-link>
    </nav>
  </div>
</template>
<script setup lang="ts">
import { useRouter } from "vue-router";
const router = useRouter();
function desktop() {
  window.localStorage.setItem("view-mode", "desktop");
  void router.push("/home");
}
</script>
<style scoped>
.mobile-watch-layout {
  --bg-primary: #fff;
  --text-primary: #222;
  width: 100%;
  overflow-x: clip;
  min-height: 100dvh;
  color: var(--text-primary);
  background: var(--bg-primary);
  padding-bottom: calc(60px + env(safe-area-inset-bottom));
}
:global([data-theme="dark"]) .mobile-watch-layout {
  --bg-primary: #181818;
  --text-primary: #eee;
}
.mobile-watch-header {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: env(safe-area-inset-top) 12px 0;
  border-bottom: 1px solid #8883;
}
.mobile-watch-content {
  position: relative;
  z-index: 0;
  max-width: 900px;
  margin: 0 auto;
}
.mobile-watch-content.session-content {
  max-width: 1400px;
}
.mobile-watch-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--bg-primary, #181818);
  border-top: 1px solid #8885;
}
.mobile-watch-nav a {
  flex: 1;
  text-align: center;
  padding: 18px 8px;
  text-decoration: none;
  color: inherit;
}
.mobile-watch-nav .selected {
  color: #36ad6a;
  font-weight: 600;
}
.mobile-watch-layout :deep(.file-player-page) {
  height: calc(100dvh - 116px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
}
</style>
