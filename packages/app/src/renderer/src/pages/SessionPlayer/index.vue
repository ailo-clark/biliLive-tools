<template>
  <div class="session-player-page">
    <header v-if="session" class="session-header">
      <div>
        <h1>{{ session.title || "未命名场次" }}</h1>
        <p>
          {{ session.streamerName }} · {{ date }} <span v-if="session.crossesMidnight">· 跨日</span>
        </p>
      </div>
      <n-button quaternary @click="calendar">录播日历</n-button>
    </header>
    <n-alert v-if="error" type="error" class="player-notice"
      >{{ error
      }}<n-button v-if="failedClip" size="small" @click="select(failedClip)"
        >重试</n-button
      ></n-alert
    >
    <n-alert v-if="message" type="info" :show-icon="false" class="player-notice">{{
      message
    }}</n-alert>
    <n-alert v-if="source?.type === 'flv'" type="info" :show-icon="false"
      >FLV 在部分手机浏览器中无法播放，建议在电脑版转换为 MP4。</n-alert
    >
    <div class="session-player-grid">
      <section class="video-section">
        <div class="session-video">
          <Artplayer
            v-if="source"
            :key="source.sequence"
            ref="playerRef"
            :option="{
              url: source.url,
              type: source.type,
              fullscreen: true,
              autoplay: source.autoplay,
            }"
            :plugins="['ass', 'danmuku']"
            :watch-source="{ recordId: source.recordId, videoId: source.videoId }"
            @ready="ready"
            @watch-state="updateWatch"
            @finished="finished"
            @error="error = '该分段播放失败或浏览器不支持此格式，可选择其他分段或重试'"
          />
          <div v-else class="video-placeholder">
            <n-spin :show="loading" /><span>{{
              loading ? "正在加载场次…" : "暂无可播放的分段"
            }}</span>
          </div>
        </div>
        <div class="playback-controls">
          <span>{{
            currentIndex >= 0 ? `第 ${currentIndex + 1} / ${clips.length} 段` : "分集播放"
          }}</span
          ><n-space
            ><n-button
              :disabled="loading || currentIndex <= 0"
              @click="select(clips[currentIndex - 1])"
              >上一段</n-button
            ><n-button
              :disabled="loading || currentIndex < 0 || currentIndex >= clips.length - 1"
              @click="select(clips[currentIndex + 1])"
              >下一段</n-button
            ></n-space
          >
        </div>
      </section>
      <aside class="episode-panel">
        <div class="episodes-heading">
          <div>
            <h2>分集</h2>
            <p>{{ sessionWatchLabel(summary) }}</p>
          </div>
          <label class="autoplay-setting"
            ><n-switch v-model:value="autoplay" size="small" aria-label="自动连播" />自动连播</label
          >
        </div>
        <div class="episodes">
          <div
            v-for="(clip, index) in clips"
            :key="clip.id"
            class="episode"
            :class="{ selected: clip.id === source?.recordId, completed: clip.watch?.completed }"
          >
            <button
              type="button"
              class="episode-select"
              :aria-label="`播放第 ${index + 1} 段`"
              :aria-current="clip.id === source?.recordId ? 'true' : undefined"
              @click="select(clip)"
            >
              <span class="episode-number">{{ index + 1 }}</span
              ><span class="episode-info"
                ><strong>{{ clip.title || "未命名分段" }}</strong
                ><span
                  >{{ formatDuration(clip.video_duration) }} · {{ watchLabel(clip.watch) }}</span
                ></span
              ></button
            ><WatchToggleButton
              :completed="clip.watch?.completed"
              :loading="marking === clip.id"
              @click="mark(clip)"
            />
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useRoute, useRouter, onBeforeRouteLeave } from "vue-router";
import watchApi, {
  watchLabel,
  sessionWatchLabel,
  type WatchSession,
  type WatchClip,
  type WatchState,
  type SessionWatchState,
} from "@renderer/apis/watchHistory";
import { recordHistoryApi, commonApi, danmaApi } from "@renderer/apis";
import { formatDuration } from "@renderer/utils";
import { resumeClip } from "@renderer/utils/sessionPlayback";
import Artplayer from "@renderer/components/Artplayer/Index.vue";
import WatchToggleButton from "@renderer/components/WatchToggleButton.vue";
import type ArtplayerType from "artplayer";
const route = useRoute();
const router = useRouter();
const streamerId = Number(route.query.streamerId);
const sessionKey = typeof route.query.sessionKey === "string" ? route.query.sessionKey : "";
const requestedRecordId = Number(route.query.recordId);
const session = ref<WatchSession>();
const clips = ref<WatchClip[]>([]);
const source = ref<{
  sequence: number;
  recordId: number;
  videoId: string;
  url: string;
  type: string;
  autoplay: boolean;
  danma?: { type: string; content: any };
}>();
const playerRef = ref<any>();
const loading = ref(false);
const error = ref("");
const message = ref("");
const failedClip = ref<WatchClip>();
const marking = ref<number>();
let sequence = 0;
let disposed = false;
const autoplay = ref(localStorage.getItem("watch-session-autoplay") !== "false");
watch(autoplay, (value) => {
  try {
    localStorage.setItem("watch-session-autoplay", String(value));
  } catch {}
});
const currentIndex = computed(() =>
  clips.value.findIndex((clip) => clip.id === source.value?.recordId),
);
const summary = computed<SessionWatchState>(() => {
  const completedCount = clips.value.filter((clip) => clip.watch?.completed).length;
  const completed = clips.value.length > 0 && completedCount === clips.value.length;
  const lastPlayedAt = clips.value.reduce(
    (n, clip) => Math.max(n, clip.watch?.lastPlayedAt || 0),
    0,
  );
  return {
    completedCount,
    totalCount: clips.value.length,
    completed,
    lastPlayedAt,
    status: completed ? "completed" : completedCount || lastPlayedAt ? "watching" : "unwatched",
  };
});
const date = computed(() =>
  session.value
    ? new Date(session.value.startTime || session.value.recordStartTime).toLocaleString("zh-CN", {
        hour12: false,
        timeZone: session.value.timeZone,
      })
    : "",
);
function calendar() {
  void router.push({ name: "MobileStreamerCalendar", params: { streamerId } });
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    if (!Number.isSafeInteger(streamerId) || streamerId <= 0 || !sessionKey)
      throw new Error("缺少有效的场次标识，请从日历重新进入");
    const result = await watchApi.sessionClips({ streamerId, sessionKey });
    if (disposed) return;
    clips.value = result.data;
    session.value = result.session;
    const clip =
      clips.value.find((item) => item.id === requestedRecordId) || resumeClip(clips.value);
    if (clip) await select(clip);
    else error.value = "该场次没有可播放的分段";
  } catch (e: any) {
    if (!disposed) error.value = String(e?.message || e || "获取场次失败");
  } finally {
    if (!disposed) loading.value = false;
  }
}
async function select(clip: WatchClip, play = true) {
  if (!clip || disposed) return;
  const current = ++sequence;
  loading.value = true;
  error.value = "";
  message.value = "";
  failedClip.value = undefined;
  try {
    await playerRef.value?.persist();
    if (current !== sequence || disposed) return;
    const file = await recordHistoryApi.getFileInfo(clip.id);
    if (file.videoFileExt === "ts")
      throw new Error("TS 分段暂不支持浏览器直接播放，请选择其他分段或在电脑版转换");
    const url = await commonApi.getVideo(file.videoFileId);
    let danma: { type: string; content: any } | undefined;
    if (file.danmaFileId) {
      try {
        const parsed = await danmaApi.getParsedContentById(file.danmaFileId);
        danma = { type: parsed.danmaType, content: parsed.content };
      } catch {
        if (current === sequence && !disposed) message.value = "弹幕暂不可用，视频仍可播放";
      }
    }
    if (current !== sequence || disposed) return;
    source.value = {
      sequence: current,
      autoplay: play,
      recordId: clip.id,
      videoId: file.videoFileId,
      url,
      type: file.videoFileExt,
      danma,
    };
  } catch (e: any) {
    if (current === sequence && !disposed) {
      error.value = String(e?.message || e || "分段加载失败");
      failedClip.value = clip;
    }
  } finally {
    if (current === sequence && !disposed) loading.value = false;
  }
}
async function ready(instance: ArtplayerType) {
  const current = source.value;
  if (!current) return;
  try {
    if (current.danma?.type === "ass") await playerRef.value?.switchAss(current.danma.content);
    else if (current.danma?.type === "xml")
      await playerRef.value?.switchDanmuku(current.danma.content);
    if (current.autoplay && source.value?.sequence === current.sequence && !disposed)
      await instance.play();
  } catch {
    if (!disposed && source.value?.sequence === current.sequence)
      message.value = "请点击播放器上的播放按钮继续";
  }
}
function updateWatch(state: WatchState | null) {
  if (!state || !source.value || state.recordId !== source.value.recordId) return;
  const clip = clips.value.find((item) => item.id === state.recordId);
  if (clip) clip.watch = state;
}
async function finished() {
  if (disposed || loading.value) return;
  const next = clips.value[currentIndex.value + 1];
  if (autoplay.value && next) await select(next);
  else message.value = next ? "本段播放结束，可选择下一段继续观看" : "本场播放结束";
}
async function mark(clip: WatchClip) {
  marking.value = clip.id;
  try {
    if (clip.id === source.value?.recordId) await playerRef.value?.persist();
    const state = await watchApi.resolve({ recordId: clip.id });
    const result = await watchApi.update(state.key, {
      revision: state.revision,
      action: state.completed ? "unwatched" : "completed",
    });
    clip.watch = result.state;
    if (result.conflict) {
      error.value = "观看状态已在其他页面更新，请重试";
      return;
    }
    // Refresh the current player's revision by remounting it, without autoplay.
    if (clip.id === source.value?.recordId) {
      source.value = undefined;
      await nextTick();
      await select(clip, false);
    }
    window.dispatchEvent(new Event("watch-history-updated"));
  } catch (e: any) {
    error.value = String(e?.message || e || "更新状态失败");
  } finally {
    marking.value = undefined;
  }
}
onMounted(load);
onBeforeRouteLeave(async () => {
  await playerRef.value?.persist();
});
onBeforeUnmount(() => {
  disposed = true;
  sequence++;
});
</script>
<style scoped>
.session-player-page {
  color: var(--watch-text);
  padding: 18px 16px;
}
.session-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
}
h1 {
  font-size: 20px;
  margin: 0;
  overflow-wrap: anywhere;
}
.session-header p {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--watch-secondary);
}
.player-notice {
  margin-bottom: 12px;
}
.session-player-grid {
  display: grid;
  gap: 20px;
}
.video-section {
  min-width: 0;
  container-type: inline-size;
}
.session-video {
  height: clamp(260px, 40vw, 560px);
  height: calc(56.25cqw + 90px);
  max-height: calc(100dvh - 300px);
  min-height: 220px;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
}
.session-video :deep(.watch-toolbar) {
  background: var(--watch-surface);
  padding: 8px;
}
.video-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: #aaa;
}
.playback-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
  font-size: 13px;
}
.playback-controls :deep(button) {
  min-height: 44px;
}
.episode-panel {
  border: 1px solid var(--watch-border);
  border-radius: 16px;
  padding: 16px;
  min-width: 0;
}
.episodes-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
}
h2 {
  font-size: 18px;
  margin: 0;
}
.episodes-heading p {
  font-size: 12px;
  color: var(--watch-secondary);
  margin: 7px 0 0;
}
.autoplay-setting {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  white-space: nowrap;
}
.episodes {
  display: grid;
  gap: 8px;
}
.episode {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--watch-border);
  border-radius: 10px;
  padding: 6px;
}
.episode.selected {
  background: var(--watch-primary-bg);
  border-color: var(--watch-primary);
}
.episode-select {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 0;
  padding: 8px 4px;
  text-align: left;
  color: var(--watch-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.episode-select:focus-visible {
  outline: 2px solid var(--watch-primary);
  border-radius: 6px;
}
.episode-number {
  font-size: 16px;
  color: var(--watch-primary);
  padding: 0 4px;
}
.episode-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.episode-info strong {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.episode-info > span {
  font-size: 12px;
  color: var(--watch-secondary);
}
.episode.completed .episode-info strong {
  color: var(--watch-muted);
}
@media (min-width: 1000px) {
  .session-player-grid {
    grid-template-columns: minmax(0, 1fr) 300px;
  }
  .episodes {
    max-height: 65vh;
    overflow: auto;
  }
}
</style>
