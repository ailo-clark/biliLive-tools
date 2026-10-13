<template>
  <article class="watch-card">
    <div class="watch-card-title" :class="{ completed: watch?.completed }">
      {{ title || "未命名录像" }}
    </div>
    <div v-if="subtitle" class="watch-card-subtitle">{{ subtitle }}</div>
    <div class="watch-card-state">{{ watchLabel(watch) }}</div>
    <n-progress
      v-if="watch?.duration"
      type="line"
      :percentage="
        watch.completed ? 100 : Math.min(100, Math.round((watch.position / watch.duration) * 100))
      "
      :status="watch.completed ? 'success' : 'default'"
      :show-indicator="false"
    />
    <div class="watch-card-actions">
      <n-button type="primary" @click="$emit('play')">{{
        watch?.position && !watch.completed ? "继续观看" : "播放"
      }}</n-button>
      <WatchToggleButton :completed="watch?.completed" @click="$emit('mark')" />
    </div>
  </article>
</template>
<script setup lang="ts">
import { watchLabel, type WatchState } from "@renderer/apis/watchHistory";
import WatchToggleButton from "./WatchToggleButton.vue";
defineProps<{ title: string; subtitle?: string; watch?: WatchState | null }>();
defineEmits<{ (event: "play"): void; (event: "mark"): void }>();
</script>
<style scoped>
.watch-card {
  padding: 16px;
  border: 1px solid var(--border-color, #8885);
  border-radius: 12px;
  min-width: 0;
}
.watch-card-title {
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.watch-card-title.completed {
  color: #888;
}
.watch-card-subtitle,
.watch-card-state {
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.8;
}
.watch-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}
.watch-card-actions :deep(button) {
  min-height: 44px;
}
</style>
