<template>
  <div class="watch-history-page">
    <h2>{{ mobile ? "继续观看" : "观看历史" }}</h2>
    <n-space class="filters">
      <n-select
        v-model:value="status"
        :options="options"
        style="width: 160px"
        aria-label="观看状态筛选"
      />
      <n-button :loading="loading" @click="load">刷新</n-button>
    </n-space>
    <n-alert v-if="error" type="error" class="filters">{{ error }}</n-alert>
    <n-spin :show="loading">
      <div class="watch-grid">
        <WatchCard
          v-for="item in items"
          :key="item.key"
          :title="item.title"
          :watch="item"
          @play="play(item)"
          @mark="mark(item)"
        />
      </div>
      <n-empty
        v-if="!loading && !items.length"
        description="暂无观看记录，打开录像播放后会自动保存"
      />
    </n-spin>
    <n-button v-if="items.length && hasMore" class="more" :loading="loading" @click="loadMore"
      >加载更多</n-button
    >
    <template v-if="mobile">
      <h2>最近录像</h2>
      <n-alert v-if="latestError" type="error">{{ latestError }}</n-alert>
      <div class="watch-grid">
        <WatchCard
          v-for="record in latest"
          :key="record.id"
          :title="record.title"
          :subtitle="record.streamer_name"
          :watch="record.watch"
          @play="openRecord(record.id)"
          @mark="markRecord(record)"
        />
      </div>
      <n-empty
        v-if="!latest.length && !latestError"
        description="暂无录制历史，可前往文件页浏览已有录像"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import WatchCard from "@renderer/components/WatchCard.vue";
import watchApi, { type WatchState } from "@renderer/apis/watchHistory";
import { playRecord, playWatch } from "@renderer/utils/pages";
const props = defineProps<{ mobile?: boolean }>();
const status = ref<"all" | "watching" | "completed">(props.mobile ? "watching" : "all");
const options = [
  { label: "全部历史", value: "all" },
  { label: "观看中", value: "watching" },
  { label: "已看完", value: "completed" },
];
const items = ref<WatchState[]>([]);
const latest = ref<Awaited<ReturnType<typeof watchApi.library>>["data"]>([]);
const loading = ref(false);
const error = ref("");
const latestError = ref("");
const hasMore = ref(false);
async function loadMore() {
  loading.value = true;
  error.value = "";
  try {
    const data = await watchApi.recent(status.value, items.value.length);
    items.value.push(...data);
    hasMore.value = data.length === 30;
  } catch (e: any) {
    error.value = String(e?.message || e || "获取观看历史失败");
  } finally {
    loading.value = false;
  }
}
async function load() {
  items.value = [];
  await loadMore();
  if (props.mobile) {
    try {
      latest.value = (await watchApi.library({})).data.slice(0, 6);
      latestError.value = "";
    } catch (e: any) {
      latestError.value = String(e?.message || e || "获取录像失败");
    }
  }
}
async function play(item: WatchState) {
  try {
    await playWatch(item.key);
  } catch (e: any) {
    error.value = String(e?.message || e || "无法播放");
  }
}
async function openRecord(id: number) {
  try {
    await playRecord(id);
  } catch (e: any) {
    error.value = String(e?.message || e || "无法播放");
  }
}
async function mark(item: WatchState) {
  try {
    const current = await watchApi.get(item.key);
    await watchApi.update(item.key, {
      revision: current.revision,
      action: current.completed ? "unwatched" : "completed",
    });
    await load();
  } catch (e: any) {
    error.value = String(e?.message || e || "更新状态失败");
  }
}
async function markRecord(record: (typeof latest.value)[number]) {
  try {
    const current = await watchApi.resolve({ recordId: record.id });
    await mark(current);
  } catch (e: any) {
    error.value = String(e?.message || e || "更新状态失败");
  }
}
watch(status, load);
const refresh = () => {
  if (!loading.value) void load();
};
onMounted(() => {
  void load();
  window.addEventListener("focus", refresh);
  window.addEventListener("watch-history-updated", refresh);
});
onBeforeUnmount(() => {
  window.removeEventListener("focus", refresh);
  window.removeEventListener("watch-history-updated", refresh);
});
</script>
<style scoped>
.watch-history-page {
  padding: 16px;
}
.filters {
  margin-bottom: 16px;
}
.watch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 12px;
}
.more {
  margin-top: 16px;
}
</style>
