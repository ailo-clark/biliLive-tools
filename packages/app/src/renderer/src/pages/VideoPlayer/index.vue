<template>
  <div class="file-player-page">
    <n-alert v-if="loading" :show-icon="false">正在加载录像…</n-alert>
    <n-alert v-if="playbackError" type="error"
      >{{ playbackError }}。可返回列表重新打开；手机浏览器请优先播放 H.264/AAC 编码的
      MP4，其他格式可能需要转码。</n-alert
    >
    <n-alert v-if="fileType === 'flv' && !playbackError" type="info" :show-icon="false"
      >FLV 在部分手机浏览器中无法播放，可在电脑版转换为 MP4。</n-alert
    >
    <!-- <n-card size="small">
      {{ videoUrl }}
      <n-space vertical :size="8">
        <n-text strong>{{ fileName || "未选择视频文件" }}</n-text>
        <n-text depth="3">视频 ID：{{ videoId || "--" }}</n-text>
      </n-space>
    </n-card> -->

    <!-- <n-alert type="warning" :show-icon="false">
        当前 .ts 分片文件不支持在播放页直接播放，请下载后用外部播放器处理，或先合并为 mp4/flv
        等容器格式。
      </n-alert> -->

    <!-- <n-empty v-if="!videoId" description="未收到视频 ID，请从文件浏览器重新进入" /> -->

    <div class="player">
      <Artplayer
        ref="playerRef"
        :option="playerOptions"
        :plugins="['ass', 'danmuku']"
        :watch-source="{ videoId: currentVideoId, recordId }"
        @ready="handlePlayerReady"
        @error="playbackError = '视频播放失败或浏览器不支持该格式'"
      />
    </div>
    <!-- <n-empty v-else description="暂时无法生成播放地址" class="player-empty" /> -->
  </div>
</template>

<script setup lang="ts">
import { commonApi } from "@renderer/apis";
import { danmaApi } from "@renderer/apis";
import Artplayer from "@renderer/components/Artplayer/Index.vue";
import { useNotice } from "@renderer/hooks/useNotice";
import { useRoute } from "vue-router";

import type ArtplayerType from "artplayer";

defineOptions({
  name: "VideoPlayer",
});

const route = useRoute();
const notice = useNotice();

const loading = ref(false);
const playbackError = ref("");
const videoUrl = ref("");
const currentVideoId = ref("");
const playerRef = ref<any>(null);
const playerReady = ref(false);

const videoId = computed(() =>
  typeof route.query.videoId === "string" ? route.query.videoId : "",
);
const recordId = computed(() => {
  const id = Number(route.query.recordId);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
});
const fileType = computed(() => (typeof route.query.type === "string" ? route.query.type : ""));
const danmaId = computed(() =>
  typeof route.query.danmaId === "string" ? route.query.danmaId : "",
);

const playerOptions = computed(() => ({
  fullscreen: true,
}));

const syncPlayerSource = async () => {
  if (!playerReady.value || !videoUrl.value) {
    return;
  }
  await playerRef.value?.switchUrl(videoUrl.value, fileType.value);
};

const syncDanmaSource = async () => {
  if (!playerReady.value) {
    return;
  }

  if (!danmaId.value) {
    return;
  }

  const data = await danmaApi.getParsedContentById(danmaId.value);
  if (data.danmaType === "ass") {
    const content = typeof data.content === "string" ? data.content : "";
    await playerRef.value?.switchAss(content);
    return;
  }

  if (data.danmaType === "xml") {
    const danmuku = Array.isArray(data.content) ? data.content : [];
    await playerRef.value?.switchDanmuku(danmuku);
    return;
  }

  notice.warning({
    title: `暂不支持加载 ${data.danmaType} 格式的弹幕`,
  });
};

const loadVideo = async () => {
  if (!videoId.value) {
    videoUrl.value = "";
    return;
  }

  loading.value = true;
  try {
    currentVideoId.value = videoId.value;
    videoUrl.value = await commonApi.getVideo(currentVideoId.value);
    await syncPlayerSource();
  } catch (error: any) {
    videoUrl.value = "";
    playbackError.value = error?.message || String(error || "获取播放地址失败");
    notice.error({
      title: error?.message || error || "获取播放地址失败",
    });
  } finally {
    loading.value = false;
  }
};

const handlePlayerReady = async (_instance: ArtplayerType) => {
  playerReady.value = true;
  await syncPlayerSource();
  await syncDanmaSource();
};

onMounted(() => {
  loadVideo();
});
</script>

<style lang="less">
.main-container.VideoPlayer {
  margin: 0 !important;
}
</style>

<style scoped lang="less">
.file-player-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  height: 100dvh;
}

.header {
  padding: 6px 0;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
}

.player {
  flex: 1;
  display: block;
  background: #000;
  min-height: 0;
}

.player-empty {
  padding: 48px 0;
}
</style>
