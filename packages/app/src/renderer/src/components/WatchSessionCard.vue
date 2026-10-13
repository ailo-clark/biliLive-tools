<template>
  <details class="session-card" @toggle="toggle">
    <summary>
      <div class="session-heading">
        <span class="session-title" :class="{ completed: summary.completed }">{{
          session.title || "未命名场次"
        }}</span>
        <n-icon class="expand-icon" :size="20"><ChevronForwardOutline /></n-icon>
      </div>
      <div class="session-meta">{{ session.streamerName || session.roomId }} · {{ dateLabel }}</div>
      <div class="session-state">
        <n-tag
          size="small"
          :type="summary.completed ? 'default' : summary.status === 'watching' ? 'info' : 'warning'"
          >{{ sessionWatchLabel(summary) }}</n-tag
        >
      </div>
      <div class="session-meta">{{ session.clipCount }} 个分段 · 点击展开</div>
    </summary>
    <div class="session-clips">
      <n-alert v-if="error" type="error">{{ error }}</n-alert>
      <n-button v-if="error" size="small" @click="load">重试</n-button>
      <n-spin :show="loading">
        <WatchCard
          v-for="(clip, index) in clips"
          :key="clip.id"
          :title="`第 ${index + 1} 段 · ${clip.title || '未命名分段'}`"
          :subtitle="new Date(clip.record_start_time).toLocaleString()"
          :watch="clip.watch"
          @play="play(clip.id)"
          @mark="mark(clip)"
        />
      </n-spin>
    </div>
  </details>
</template>
<script setup lang="ts">
import { ChevronForwardOutline } from "@vicons/ionicons5";
import watchApi, {
  sessionWatchLabel,
  type WatchSession,
  type WatchClip,
} from "@renderer/apis/watchHistory";
import { playRecord } from "@renderer/utils/pages";
import WatchCard from "./WatchCard.vue";
const props = defineProps<{ session: WatchSession }>();
const emit = defineEmits<{ (event: "updated"): void }>();
const summary = ref(props.session.watch);
const clips = ref<WatchClip[]>([]);
const loading = ref(false);
const error = ref("");
let opened = false;
const dateLabel = computed(() => new Date(props.session.recordStartTime).toLocaleString());
watch(
  () => props.session.watch,
  (value) => {
    summary.value = value;
  },
);
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await watchApi.sessionClips({
      streamerId: props.session.streamerId,
      sessionKey: props.session.sessionKey,
    });
    clips.value = result.data;
    summary.value = result.watch;
  } catch (e: any) {
    error.value = String(e?.message || e || "获取分段失败");
  } finally {
    loading.value = false;
  }
}
function toggle(event: Event) {
  opened = (event.target as HTMLDetailsElement).open;
  if (opened) void load();
}
async function play(id: number) {
  try {
    await playRecord(id);
  } catch (e: any) {
    error.value = String(e?.message || e || "无法播放");
  }
}
async function mark(clip: WatchClip) {
  try {
    const state = await watchApi.resolve({ recordId: clip.id });
    const result = await watchApi.update(state.key, {
      revision: state.revision,
      action: state.completed ? "unwatched" : "completed",
    });
    if (result.conflict) {
      error.value = "观看状态已在其他页面更新，请重试";
      return;
    }
    await load();
    emit("updated");
    window.dispatchEvent(new Event("watch-history-updated"));
  } catch (e: any) {
    error.value = String(e?.message || e || "更新状态失败");
  }
}
const refresh = () => {
  if (opened && !loading.value) void load();
};
onMounted(() => window.addEventListener("focus", refresh));
onBeforeUnmount(() => window.removeEventListener("focus", refresh));
</script>
<style scoped>
.session-card {
  border: 1px solid #8885;
  border-radius: 12px;
  min-width: 0;
}
summary {
  list-style: none;
  cursor: pointer;
  padding: 16px;
  min-height: 44px;
}
summary::-webkit-details-marker {
  display: none;
}
summary:focus-visible {
  outline: 2px solid #18a058;
  border-radius: 12px;
}
.session-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.session-title {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.completed {
  color: #888;
}
.session-meta {
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.8;
  overflow-wrap: anywhere;
}
.session-state {
  margin-top: 12px;
}
.expand-icon {
  flex-shrink: 0;
  transition: transform 0.2s;
}
.session-card[open] .expand-icon {
  transform: rotate(90deg);
}
.session-clips {
  padding: 0 12px 12px;
}
.session-clips :deep(.watch-card) {
  margin-top: 10px;
}
</style>
