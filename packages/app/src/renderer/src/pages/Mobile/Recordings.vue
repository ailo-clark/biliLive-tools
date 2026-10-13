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
        <WatchCard
          v-for="record in items"
          :key="record.id"
          :title="record.title"
          :subtitle="`${record.streamer_name || record.room_id} · ${new Date(record.record_start_time).toLocaleString()}`"
          :watch="record.watch"
          @play="play(record.id)"
          @mark="mark(record)"
        />
      </div>
      <n-empty v-if="!loading && !items.length" description="没有符合条件的录像" />
    </n-spin>
    <n-button v-if="cursor" block :loading="loading" @click="loadMore">加载更多</n-button>
  </div>
</template>
<script setup lang="ts">
import WatchCard from "@renderer/components/WatchCard.vue";
import watchApi from "@renderer/apis/watchHistory";
import { playRecord } from "@renderer/utils/pages";
const items = ref<Awaited<ReturnType<typeof watchApi.library>>["data"]>([]);
const search = ref("");
const status = ref("all");
const options = [
  { label: "全部录像", value: "all" },
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
    const result = await watchApi.library({
      before: cursor.value || undefined,
      status: status.value,
      search: search.value,
    });
    if (current !== generation) return;
    items.value.push(...result.data);
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
async function play(id: number) {
  try {
    await playRecord(id);
  } catch (e: any) {
    error.value = String(e?.message || e || "无法播放");
  }
}
async function mark(record: (typeof items.value)[number]) {
  try {
    const state = await watchApi.resolve({ recordId: record.id });
    await watchApi.update(state.key, {
      revision: state.revision,
      action: state.completed ? "unwatched" : "completed",
    });
    await load();
  } catch (e: any) {
    error.value = String(e?.message || e || "更新状态失败");
  }
}
watch(status, load);
onMounted(load);
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
