<template>
  <div class="recordings-page">
    <n-tabs type="line" animated>
      <n-tab-pane name="streamers" tab="按主播"><WatchStreamerGallery /></n-tab-pane>
      <n-tab-pane name="sessions" tab="按场次"><SessionList /></n-tab-pane>
    </n-tabs>
  </div>
</template>
<script setup lang="ts">
import WatchStreamerGallery from "@renderer/components/WatchStreamerGallery.vue";
import SessionList from "./SessionList.vue";
</script>
<style scoped>
.recordings-page {
  padding: 16px;
}
.recordings-page :deep(.mobile-recordings) {
  padding: 0;
}
</style>
