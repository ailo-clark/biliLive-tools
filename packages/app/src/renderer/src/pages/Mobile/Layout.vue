<template>
  <n-config-provider :theme-overrides="watchThemeOverrides">
    <div class="mobile-watch-layout" :class="{ 'desktop-watch': !isMobile }">
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
        <strong>{{ isMobile ? "biliLive-tools" : "观看" }}</strong>
        <div class="header-actions">
          <n-dropdown trigger="click" :options="themeOptions" @select="themeStore.setTheme">
            <n-button quaternary circle aria-label="切换观看页主题">
              <n-icon :size="20"><ColorPaletteOutline /></n-icon>
            </n-button>
          </n-dropdown>
          <n-button size="small" @click="desktop">{{ isMobile ? "电脑版" : "主页" }}</n-button>
        </div>
      </header>
      <nav class="mobile-watch-nav" aria-label="观看导航">
        <router-link to="/mobile" exact-active-class="selected">首页</router-link>
        <router-link to="/mobile/recordings" active-class="selected">录像</router-link>
        <router-link to="/mobile/files" active-class="selected">文件</router-link>
      </nav>
      <main
        class="mobile-watch-content"
        :class="{ 'session-content': $route.name === 'MobileSessionPlayer' }"
      >
        <router-view :key="$route.fullPath" />
      </main>
    </div>
  </n-config-provider>
</template>
<script setup lang="ts">
import { useRouter } from "vue-router";
import { ColorPaletteOutline } from "@vicons/ionicons5";
import { useBreakpoints } from "@renderer/hooks/useBreakpoints";
import { useThemeStore } from "@renderer/stores/theme";
import type { GlobalThemeOverrides } from "naive-ui";
const router = useRouter();
const { isMobile } = useBreakpoints();
const themeStore = useThemeStore();
const watchThemeOverrides = computed<GlobalThemeOverrides>(() => ({
  common:
    themeStore.theme === "dark"
      ? {
          placeholderColor: "#a3aab5",
        }
      : {
          primaryColor: "#06734f",
          primaryColorHover: "#055f42",
          primaryColorPressed: "#044f36",
          primaryColorSuppl: "#06734f",
          placeholderColor: "#646b78",
        },
}));
const themeOptions = [
  { label: "浅色", key: "light" },
  { label: "深色", key: "dark" },
  { label: "自动（跟随系统）", key: "system" },
];
function desktop() {
  window.localStorage.setItem("view-mode", "desktop");
  void router.push("/home");
}
</script>
<style scoped>
.mobile-watch-layout {
  width: 100%;
  overflow-x: clip;
  min-height: 100dvh;
  color: var(--watch-text);
  background: var(--bg-primary);
  padding-bottom: calc(60px + env(safe-area-inset-bottom));
}
.desktop-watch {
  min-height: 100%;
  padding-bottom: 0;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mobile-watch-header {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: env(safe-area-inset-top) 12px 0;
  border-bottom: 1px solid var(--watch-border);
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
  border-top: 1px solid var(--watch-border);
}
.mobile-watch-nav a {
  flex: 1;
  text-align: center;
  padding: 18px 8px;
  text-decoration: none;
  color: inherit;
}
.mobile-watch-nav .selected {
  color: var(--watch-primary);
  font-weight: 600;
}
.desktop-watch .mobile-watch-nav {
  position: static;
  border-top: 0;
  border-bottom: 1px solid var(--watch-border);
}
.desktop-watch .mobile-watch-nav a {
  flex: 0 1 120px;
  padding: 12px 8px;
}
.desktop-watch :deep(.file-player-page) {
  height: calc(100dvh - 103px);
}
.mobile-watch-layout :deep(.file-player-page) {
  height: calc(100dvh - 116px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
}
</style>
