<template>
  <div class="mobile-home">
    <div class="heading">
      <h2>继续观看</h2>
      <n-button :loading="loading" @click="load">刷新</n-button>
    </div>
    <n-alert v-if="error" type="error">{{ error }}</n-alert>
    <n-spin :show="loading">
      <div class="sessions">
        <WatchSessionCard
          v-for="session in watching"
          :key="session.key"
          :session="session"
          @updated="load"
        />
      </div>
      <n-empty v-if="!loading && !watching.length" description="暂无观看中的直播场次" />
      <div class="heading">
        <h2>最近场次</h2>
        <router-link to="/mobile/recordings">全部场次</router-link>
      </div>
      <div class="sessions">
        <WatchSessionCard
          v-for="session in latest"
          :key="session.key"
          :session="session"
          @updated="load"
        />
      </div>
      <n-empty
        v-if="!loading && !latest.length"
        description="暂无录制场次，可前往文件页浏览已有录像"
      />
    </n-spin>
  </div>
</template>
<script setup lang="ts">
import WatchSessionCard from "@renderer/components/WatchSessionCard.vue";
import watchApi, { type WatchSession } from "@renderer/apis/watchHistory";
const watching = ref<WatchSession[]>([]);
const latest = ref<WatchSession[]>([]);
const loading = ref(false);
const error = ref("");
let generation = 0;
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const [recent, library] = await Promise.all([
      watchApi.sessions({ recent: true, status: "watching", limit: 6 }),
      watchApi.sessions({ limit: 6 }),
    ]);
    if (current !== generation) return;
    watching.value = recent.data;
    latest.value = library.data;
  } catch (e: any) {
    if (current === generation) error.value = String(e?.message || e || "获取直播场次失败");
  } finally {
    if (current === generation) loading.value = false;
  }
}
const refresh = () => {
  if (!loading.value) void load();
};
onMounted(() => {
  void load();
  window.addEventListener("focus", refresh);
});
onBeforeUnmount(() => {
  generation++;
  window.removeEventListener("focus", refresh);
});
</script>
<style scoped>
.mobile-home {
  padding: 16px;
}
.heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.sessions {
  display: grid;
  gap: 12px;
  margin: 12px 0;
}
</style>
