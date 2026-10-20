<template>
  <section class="login-card">
    <div class="login-symbol">▶</div>
    <h1>录播回放</h1>
    <p>登录后查看主播日历、继续观看与播放进度</p>
    <form @submit.prevent="login">
      <label for="passkey">Docker 登录密钥</label>
      <n-input
        id="passkey"
        v-model:value="key"
        type="password"
        show-password-on="click"
        autocomplete="current-password"
        placeholder="输入 BILILIVE_TOOLS_PASSKEY"
      />
      <n-alert v-if="error" type="error">{{ error }}</n-alert>
      <n-button type="primary" attr-type="submit" block :loading="loading">进入回放</n-button>
    </form>
    <p class="login-note">使用现有 biliLive-tools 的登录密钥。插件不会修改录制配置。</p>
  </section>
</template>
<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import request from "@renderer/apis/request";
import { setAuthKey, clearAuthKey } from "@renderer/apis/authStorage";
import { ReplayLoginError, verifyReplayLogin } from "./login";
const route = useRoute();
const router = useRouter();
const key = ref("");
const error = ref("");
const loading = ref(false);
async function login() {
  if (loading.value || !key.value.trim()) return;
  loading.value = true;
  error.value = "";
  try {
    clearAuthKey();
    await verifyReplayLogin(request, key.value.trim());
    setAuthKey(key.value.trim());
    const target =
      typeof route.query.redirect === "string" && /^\/mobile(?:\/|$)/.test(route.query.redirect)
        ? route.query.redirect
        : "/mobile";
    await router.replace(target);
  } catch (cause) {
    error.value =
      cause instanceof ReplayLoginError
        ? cause.message
        : "无法连接录播接口，请检查 NAS 客户端连接及 Docker 服务后重试";
  } finally {
    loading.value = false;
  }
}
</script>
