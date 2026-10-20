<template>
  <n-config-provider :theme="theme.themeUI" :locale="zhCN" :date-locale="dateZhCN">
    <n-notification-provider
      ><n-dialog-provider
        ><n-message-provider>
          <div class="replay-app">
            <header class="app-header">
              <div class="header-start">
                <n-button
                  v-if="route.name !== 'ReplayHome' && route.name !== 'Login'"
                  quaternary
                  circle
                  aria-label="返回"
                  @click="back"
                  ><n-icon><ArrowBackOutline /></n-icon
                ></n-button>
                <router-link class="brand" to="/mobile"
                  ><span class="brand-icon">▶</span
                  ><span>录播回放<small>小米 NAS</small></span></router-link
                >
              </div>
              <div class="header-actions">
                <n-select
                  aria-label="主题"
                  size="small"
                  :value="preference"
                  :options="themes"
                  @update:value="changeTheme"
                  class="theme-select"
                />
                <n-tooltip v-if="route.name !== 'Login'"
                  ><template #trigger
                    ><n-button quaternary circle aria-label="退出登录" @click="logout"
                      ><n-icon><LogOutOutline /></n-icon></n-button></template
                  >退出登录</n-tooltip
                >
              </div>
            </header>
            <main>
              <router-view v-slot="{ Component, route: viewRoute }"
                ><component :is="Component" :key="viewRoute.fullPath"
              /></router-view>
            </main>
            <footer class="app-footer">录播回放 · v0.1.2</footer>
          </div>
        </n-message-provider></n-dialog-provider
      ></n-notification-provider
    >
  </n-config-provider>
</template>
<script setup lang="ts">
import { dateZhCN, zhCN } from "naive-ui";
import { ArrowBackOutline, LogOutOutline } from "@vicons/ionicons5";
import { useRouter, useRoute } from "vue-router";
import { useThemeStore } from "@renderer/stores/theme";
import { clearAuthKey } from "@renderer/apis/authStorage";
const router = useRouter();
const route = useRoute();
const theme = useThemeStore();
const preference = ref(localStorage.getItem("theme") || "system");
const themes = [
  { label: "自动主题", value: "system" },
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" },
];
function changeTheme(value: "system" | "light" | "dark") {
  preference.value = value;
  theme.setTheme(value);
}
function back() {
  if (route.name === "MobileSessionPlayer" && route.query.streamerId)
    void router.push({
      name: "MobileStreamerCalendar",
      params: { streamerId: String(route.query.streamerId) },
    });
  else void router.push("/mobile");
}
async function logout() {
  await router.push("/login");
  clearAuthKey();
}
</script>
<style lang="less">
@import "../src/renderer/src/assets/css/watch.less";
html,
body,
#app {
  margin: 0;
  min-height: 100%;
}
body {
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: #f5f7f8;
  color: var(--watch-text);
}
html[data-theme="dark"] body {
  background: #17191c;
}
* {
  box-sizing: border-box;
}
button,
input {
  font: inherit;
}
.replay-app {
  min-height: 100dvh;
}
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 12px
    max(16px, env(safe-area-inset-left));
  background: var(--watch-surface);
  border-bottom: 1px solid var(--watch-border);
}
.header-start,
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand {
  display: flex;
  gap: 10px;
  align-items: center;
  text-decoration: none;
  color: var(--watch-text);
  font-size: 17px;
  font-weight: 650;
  white-space: nowrap;
}
.brand-icon,
.login-symbol {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--watch-primary-bg);
  color: var(--watch-primary);
}
.brand small {
  display: block;
  color: var(--watch-secondary);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 1px;
}
.theme-select {
  width: 104px;
}
main {
  max-width: 1440px;
  margin: 0 auto;
  min-height: calc(100dvh - 155px);
}
.app-footer {
  padding: 22px 16px max(22px, env(safe-area-inset-bottom));
  text-align: center;
  color: var(--watch-muted);
  font-size: 12px;
}
.login-card {
  width: min(420px, calc(100% - 32px));
  margin: 8vh auto;
  padding: 30px 24px;
  border: 1px solid var(--watch-border);
  border-radius: 22px;
  background: var(--watch-surface);
}
.login-symbol {
  width: 56px;
  height: 56px;
  font-size: 24px;
}
.login-card h1 {
  font-size: 26px;
  margin: 20px 0 8px;
}
.login-card p {
  color: var(--watch-secondary);
  line-height: 1.7;
}
.login-card form {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}
.login-card label {
  font-size: 14px;
}
.login-note {
  font-size: 12px;
  margin-bottom: 0;
}
@media (min-width: 900px) {
  .streamer-calendar-page {
    max-width: 1050px;
    margin: 0 auto;
  }
  .app-header {
    padding-left: max(28px, calc((100vw - 1408px) / 2));
    padding-right: max(28px, calc((100vw - 1408px) / 2));
  }
}
@media (max-width: 380px) {
  .theme-select {
    width: 90px;
  }
  .brand {
    font-size: 15px;
    gap: 6px;
  }
  .header-start {
    gap: 0;
  }
}
</style>
