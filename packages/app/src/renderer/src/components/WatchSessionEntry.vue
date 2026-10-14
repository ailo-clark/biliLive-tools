<template>
  <button type="button" class="session-entry" @click="$emit('play')">
    <span class="entry-heading"
      ><span class="entry-title" :class="{ completed: session.watch.completed }">{{
        session.title || "未命名场次"
      }}</span
      ><n-icon :size="22"><PlayCircleOutline /></n-icon
    ></span>
    <span class="entry-meta"
      >{{ session.streamerName }} · {{ time }}
      <span v-if="session.crossesMidnight" class="cross-day">跨日</span></span
    >
    <span class="entry-meta"
      >{{ session.clipCount }} 个分段 · {{ formatDuration(session.totalDuration) }}</span
    >
    <span class="entry-footer"
      ><span class="entry-state" :class="session.watch.status">{{
        sessionWatchLabel(session.watch)
      }}</span
      ><span class="entry-action">{{ continuing ? "继续观看" : "播放整场" }} →</span></span
    >
  </button>
</template>
<script setup lang="ts">
import { PlayCircleOutline } from "@vicons/ionicons5";
import { sessionWatchLabel, type WatchSession } from "@renderer/apis/watchHistory";
import { formatDuration } from "@renderer/utils";
const props = defineProps<{ session: WatchSession; timeZone?: string; continuing?: boolean }>();
defineEmits<{ (event: "play"): void }>();
const time = computed(() =>
  new Date(props.session.startTime || props.session.recordStartTime).toLocaleString("zh-CN", {
    timeZone: props.timeZone,
    hour12: false,
  }),
);
</script>
<style scoped>
.session-entry {
  display: block;
  width: 100%;
  padding: 18px;
  text-align: left;
  border: 1px solid var(--watch-border);
  border-radius: 16px;
  color: var(--watch-text);
  background: var(--watch-surface);
  cursor: pointer;
  font: inherit;
}
.session-entry:hover {
  border-color: var(--watch-primary);
}
.session-entry:focus-visible {
  outline: 2px solid var(--watch-primary);
  outline-offset: 2px;
}
.entry-heading,
.entry-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.entry-title {
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.entry-title.completed {
  color: var(--watch-muted);
}
.entry-meta {
  display: block;
  margin-top: 8px;
  font-size: 13px;
  color: var(--watch-secondary);
}
.cross-day {
  padding: 2px 6px;
  background: var(--watch-info-bg);
  color: var(--watch-info);
  border-radius: 4px;
}
.entry-footer {
  margin-top: 14px;
  flex-wrap: wrap;
  font-size: 12px;
}
.entry-state {
  padding: 4px 7px;
  border-radius: 6px;
  background: var(--watch-soft);
}
.entry-state.unwatched {
  color: var(--watch-info);
  background: var(--watch-info-bg);
}
.entry-state.watching {
  color: var(--watch-warning);
  background: var(--watch-warning-bg);
}
.entry-state.completed {
  color: var(--watch-muted);
}
.entry-action {
  color: var(--watch-primary);
  font-weight: 600;
}
</style>
