<template>
  <div class="mobile-home">
    <section class="continue-section">
      <div class="heading">
        <h2>继续观看</h2>
        <n-button :loading="loading" @click="load">刷新</n-button>
      </div>
      <n-alert v-if="error" type="error">{{ error }}</n-alert>
      <n-spin :show="loading"
        ><div class="sessions">
          <WatchSessionEntry
            v-for="session in watching"
            :key="session.key"
            :session="session"
            continuing
            @play="play(session)"
          />
        </div>
        <n-empty v-if="!loading && !watching.length" description="暂无观看中的直播场次"
      /></n-spin>
    </section>
    <WatchStreamerGallery />
  </div>
</template>
<script setup lang="ts">
import WatchStreamerGallery from "@renderer/components/WatchStreamerGallery.vue";
import WatchSessionEntry from "@renderer/components/WatchSessionEntry.vue";
import watchApi, { type WatchSession } from "@renderer/apis/watchHistory";
import { playSession } from "@renderer/utils/pages";
const watching = ref<WatchSession[]>([]);
const loading = ref(false);
const error = ref("");
let generation = 0;
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const result = await watchApi.sessions({ recent: true, status: "watching", limit: 6 });
    if (current === generation) watching.value = result.data;
  } catch (e: any) {
    if (current === generation) error.value = String(e?.message || e || "获取观看进度失败");
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function play(session: WatchSession) {
  try {
    await playSession(session);
  } catch (e: any) {
    error.value = String(e?.message || e);
  }
}
const refresh = () => {
  if (!loading.value) void load();
};
onMounted(() => {
  void load();
  window.addEventListener("focus", refresh);
  window.addEventListener("watch-library-visibility-updated", load);
});
onBeforeUnmount(() => {
  generation++;
  window.removeEventListener("focus", refresh);
  window.removeEventListener("watch-library-visibility-updated", load);
});
</script>
<style scoped>
.mobile-home {
  padding: 20px 16px;
}
.continue-section {
  margin-bottom: 32px;
}
.heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
h2 {
  font-size: 21px;
  margin: 0;
}
.sessions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 12px;
  margin: 16px 0;
}
</style>
