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
  border: 1px solid #8883;
  border-radius: 16px;
  color: inherit;
  background: var(--bg-primary, transparent);
  cursor: pointer;
  font: inherit;
}
.session-entry:hover {
  border-color: #18a058;
}
.session-entry:focus-visible {
  outline: 2px solid #18a058;
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
  color: #888;
}
.entry-meta {
  display: block;
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.75;
}
.cross-day {
  padding: 2px 6px;
  background: #2080f015;
  color: #2080f0;
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
  background: #8881;
}
.entry-state.unwatched {
  color: #2080f0;
  background: #2080f015;
}
.entry-state.watching {
  color: #b77b0b;
  background: #f0a02015;
}
.entry-state.completed {
  color: #888;
}
.entry-action {
  color: #18a058;
  font-weight: 600;
}
</style>
