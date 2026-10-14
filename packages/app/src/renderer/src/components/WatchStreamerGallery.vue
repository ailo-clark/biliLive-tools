<template>
  <section class="streamer-gallery">
    <div class="gallery-heading">
      <div>
        <h2>主播录像</h2>
        <p>选择主播，按日历回看直播</p>
      </div>
      <n-button :loading="loading" @click="load">刷新</n-button>
    </div>
    <div class="gallery-search">
      <n-input
        v-model:value="search"
        clearable
        placeholder="搜索主播、房间号或直播标题"
        @keyup.enter="load"
      /><n-button @click="load">搜索</n-button>
    </div>
    <n-alert v-if="error" type="error">{{ error }}</n-alert>
    <n-spin :show="loading">
      <div class="streamer-grid">
        <article v-for="streamer in items" :key="streamer.id" class="streamer-card">
          <button
            type="button"
            class="streamer-main"
            :aria-label="`查看 ${streamer.name} 的录播日历`"
            @click="calendar(streamer.id)"
          >
            <n-avatar
              round
              :size="56"
              :src="streamer.avatar || undefined"
              referrerpolicy="no-referrer"
              >{{ streamer.name.slice(0, 1) }}</n-avatar
            >
            <span class="streamer-info"
              ><strong>{{ streamer.name }}</strong
              ><span>{{ streamer.platform }} · {{ streamer.roomId }}</span></span
            >
            <n-icon :size="20"><ChevronForwardOutline /></n-icon>
          </button>
          <div class="streamer-counts">
            <span class="unwatched">{{ streamer.unwatchedCount }} 场未看</span
            ><span v-if="streamer.watchingCount" class="watching"
              >{{ streamer.watchingCount }} 场观看中</span
            ><span>{{ streamer.sessionCount }} 场录像</span>
          </div>
          <div class="latest-time">最近录制 · {{ date(streamer.latestSession) }}</div>
          <div class="streamer-actions">
            <n-button quaternary @click="calendar(streamer.id)"
              ><template #icon
                ><n-icon><CalendarOutline /></n-icon></template
              >录播日历</n-button
            ><n-button
              v-if="streamer.latestSession"
              quaternary
              type="primary"
              @click="play(streamer.latestSession)"
              >最近一场</n-button
            >
          </div>
        </article>
      </div>
      <n-empty
        v-if="!loading && !items.length"
        description="暂无符合条件的主播录像，可前往文件页浏览"
      />
    </n-spin>
    <n-button v-if="offset !== null" block :loading="loading" @click="more">加载更多主播</n-button>
  </section>
</template>
<script setup lang="ts">
import { CalendarOutline, ChevronForwardOutline } from "@vicons/ionicons5";
import { useRouter } from "vue-router";
import watchApi, { type WatchStreamer, type WatchSession } from "@renderer/apis/watchHistory";
import { playSession } from "@renderer/utils/pages";
const router = useRouter();
const items = ref<WatchStreamer[]>([]);
const search = ref("");
const offset = ref<number | null>(null);
const loading = ref(false);
const error = ref("");
const timeZone = ref<string>();
let generation = 0;
async function more() {
  const current = generation;
  loading.value = true;
  error.value = "";
  try {
    const result = await watchApi.streamers({ search: search.value, offset: offset.value || 0 });
    if (current !== generation) return;
    const existing = new Set(items.value.map((item) => item.id));
    items.value.push(...result.data.filter((item) => !existing.has(item.id)));
    offset.value = result.nextOffset;
    timeZone.value = result.timeZone;
  } catch (e: any) {
    if (current === generation) error.value = String(e?.message || e || "获取主播录像失败");
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function load() {
  generation++;
  items.value = [];
  offset.value = null;
  await more();
}
function calendar(id: number) {
  void router.push({ name: "MobileStreamerCalendar", params: { streamerId: id } });
}
async function play(session: WatchSession) {
  try {
    await playSession(session);
  } catch (e: any) {
    error.value = String(e?.message || e);
  }
}
function date(session: WatchSession | null) {
  return session
    ? new Date(session.startTime || session.recordStartTime).toLocaleDateString("zh-CN", {
        timeZone: timeZone.value,
      })
    : "暂无";
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
.gallery-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 21px;
}
p {
  margin: 7px 0 16px;
  font-size: 13px;
  opacity: 0.65;
}
.gallery-search {
  display: flex;
  gap: 10px;
  margin: 0 0 18px;
}
.streamer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.streamer-card {
  border: 1px solid #8883;
  border-radius: 18px;
  padding: 18px;
  box-shadow: 0 4px 16px #00000004;
  min-width: 0;
}
.streamer-card:hover {
  border-color: #18a05880;
}
.streamer-main {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 0;
  border: 0;
  text-align: left;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.streamer-main:focus-visible {
  outline: 2px solid #18a058;
  border-radius: 8px;
}
.streamer-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 6px;
}
.streamer-info strong {
  font-size: 17px;
  overflow-wrap: anywhere;
}
.streamer-info > span,
.latest-time {
  font-size: 12px;
  opacity: 0.65;
}
.streamer-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
  font-size: 12px;
}
.streamer-counts span {
  padding: 4px 7px;
  border-radius: 6px;
  background: #8881;
}
.streamer-counts .unwatched {
  color: #2080f0;
  background: #2080f015;
}
.streamer-counts .watching {
  color: #b77b0b;
  background: #f0a02015;
}
.latest-time {
  margin-top: 14px;
}
.streamer-actions {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 14px;
}
.streamer-actions :deep(button) {
  min-height: 44px;
}
</style>
