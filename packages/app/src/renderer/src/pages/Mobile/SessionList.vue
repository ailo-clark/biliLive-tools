<template>
  <div class="mobile-recordings">
    <h2>录像</h2>
    <n-space vertical class="filters">
      <n-input
        v-model:value="search"
        placeholder="搜索主播、房间号或标题"
        clearable
        @keyup.enter="load"
      />
      <n-space
        ><n-select
          v-model:value="status"
          :options="options"
          style="width: 160px"
          aria-label="录像观看状态"
        /><n-button :loading="loading" @click="load">搜索</n-button></n-space
      >
    </n-space>
    <n-alert v-if="error" type="error">{{ error }}</n-alert>
    <n-spin :show="loading">
      <div class="cards">
        <WatchSessionCard
          v-for="session in items"
          :key="session.key"
          :session="session"
          @updated="refresh"
        />
      </div>
      <n-empty v-if="!loading && !items.length" description="没有符合条件的直播场次" />
    </n-spin>
    <n-button v-if="cursor" block :loading="loading" @click="loadMore">加载更多</n-button>
  </div>
</template>
<script setup lang="ts">
import WatchSessionCard from "@renderer/components/WatchSessionCard.vue";
import watchApi, { type WatchSession } from "@renderer/apis/watchHistory";
const items = ref<WatchSession[]>([]);
const search = ref("");
const status = ref("all");
const options = [
  { label: "全部场次", value: "all" },
  { label: "未观看", value: "unwatched" },
  { label: "观看中", value: "watching" },
  { label: "已看完", value: "completed" },
];
const cursor = ref<number | null>(null);
const loading = ref(false);
const error = ref("");
let generation = 0;
async function loadMore() {
  const current = generation;
  loading.value = true;
  error.value = "";
  try {
    const result = await watchApi.sessions({
      before: cursor.value || undefined,
      status: status.value,
      search: search.value,
    });
    if (current !== generation) return;
    const keys = new Set(items.value.map((session) => session.key));
    items.value.push(...result.data.filter((session) => !keys.has(session.key)));
    cursor.value = result.nextCursor;
  } catch (e: any) {
    if (current === generation) error.value = String(e?.message || e || "获取录像失败");
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function load() {
  generation++;
  items.value = [];
  cursor.value = null;
  await loadMore();
}
async function refresh() {
  if (loading.value) return;
  if (status.value !== "all") {
    await load();
    return;
  }
  // Keep already expanded cards and the user's place in the list.
  const current = generation;
  try {
    const updated = await Promise.all(
      items.value.map(async (session) => ({
        ...session,
        watch: (
          await watchApi.sessionClips({
            streamerId: session.streamerId,
            sessionKey: session.sessionKey,
          })
        ).watch,
      })),
    );
    if (current === generation) items.value = updated;
  } catch (e: any) {
    error.value = String(e?.message || e || "刷新观看状态失败");
  }
}
watch(status, load);
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
.mobile-recordings {
  padding: 16px;
}
.filters {
  margin-bottom: 16px;
}
.cards {
  display: grid;
  gap: 12px;
  margin: 12px 0;
}
</style>
