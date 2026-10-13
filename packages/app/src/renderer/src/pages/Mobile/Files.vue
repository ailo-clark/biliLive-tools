<template>
  <div class="mobile-files">
    <h2>文件</h2>
    <div class="path">{{ currentPath || "录制目录" }}</div>
    <n-space class="tools"
      ><n-button v-if="parentPath" @click="load(parentPath)">上一级</n-button
      ><n-button :loading="loading" @click="load(currentPath)">刷新</n-button></n-space
    >
    <n-alert v-if="error" type="error">{{ error }}</n-alert>
    <n-spin :show="loading">
      <div class="files">
        <template v-for="item in items" :key="item.path">
          <n-button v-if="item.type === 'directory'" block class="folder" @click="load(item.path)"
            >📁 {{ item.name }}</n-button
          >
          <WatchCard
            v-else-if="item.fileKind === 'video'"
            :title="item.name"
            :watch="item.watch"
            @play="play(item)"
            @mark="mark(item)"
          />
        </template>
      </div>
      <n-empty v-if="!loading && !items.length" description="目录中没有录像" />
    </n-spin>
  </div>
</template>
<script setup lang="ts">
import WatchCard from "@renderer/components/WatchCard.vue";
import { fileBrowserApi, commonApi } from "@renderer/apis";
import watchApi from "@renderer/apis/watchHistory";
import { toVideoPlayerPage } from "@renderer/utils/pages";
import type { FileBrowserItem } from "@renderer/apis/fileBrowser";
const items = ref<FileBrowserItem[]>([]);
const currentPath = ref("");
const parentPath = ref<string | null>(null);
const loading = ref(false);
const error = ref("");
async function load(path?: string | null) {
  loading.value = true;
  error.value = "";
  try {
    const result = await fileBrowserApi.list(path || undefined);
    items.value = result.list.filter(
      (item) => item.type === "directory" || item.fileKind === "video",
    );
    currentPath.value = result.currentPath;
    parentPath.value = result.parentPath;
  } catch (e: any) {
    error.value = String(e?.message || e || "获取文件失败，请在电脑版设置录制目录");
  } finally {
    loading.value = false;
  }
}
async function play(item: FileBrowserItem) {
  try {
    await toVideoPlayerPage({ videoFilePath: item.path });
  } catch (e: any) {
    error.value = String(e?.message || e || "无法播放");
  }
}
async function mark(item: FileBrowserItem) {
  try {
    const { videoId } = await commonApi.applyVideoId(item.path);
    const state = await watchApi.resolve({ videoId });
    item.watch = (
      await watchApi.update(state.key, {
        revision: state.revision,
        action: state.completed ? "unwatched" : "completed",
      })
    ).state;
  } catch (e: any) {
    error.value = String(e?.message || e || "更新状态失败");
  }
}
onMounted(() => load());
</script>
<style scoped>
.mobile-files {
  padding: 16px;
}
.path {
  overflow-wrap: anywhere;
  font-size: 12px;
  opacity: 0.7;
}
.tools {
  margin: 12px 0;
}
.files {
  display: grid;
  gap: 12px;
}
.folder {
  min-height: 48px;
}
</style>
