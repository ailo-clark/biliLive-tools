<template>
  <div class="artplayer-wrapper">
    <div v-if="watchSource" class="watch-toolbar">
      <span>{{ watchLabel(watchState) }}</span>
      <template v-if="resumeAvailable">
        <n-button size="small" @click="resume">继续观看</n-button>
        <n-button size="small" @click="restart">从头播放</n-button>
      </template>
      <n-button v-else-if="watchState" size="small" @click="restart">重新播放</n-button>
      <WatchToggleButton v-if="watchState" :completed="watchState.completed" @click="mark" />
      <span class="watch-message" role="status">{{ watchMessage }}</span>
    </div>
    <div ref="artRef" class="artplayer" tabindex="0"></div>
  </div>
</template>

<script lang="ts" setup>
import Artplayer from "artplayer";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { useWatchProgress } from "@renderer/hooks/useWatchProgress";
import { watchLabel, type WatchSource, type WatchState } from "@renderer/apis/watchHistory";
import WatchToggleButton from "../WatchToggleButton.vue";

import artplayerPluginAssJS from "artplayer-plugin-assjs";
import artplayerPluginHeatmap from "./artplayer-plugin-heatmap";
import artplayerPluginTimestamp from "./artplayer-timestamp";
import artplayerPluginDanmuku from "artplayer-plugin-danmuku";
import artplayerPluginHlsControl from "artplayer-plugin-hls-control";
import artplayerPluginSubtitle from "./artplayer-plugin-subtitle";
import artplayerPluginChapter from "./artplayer-plugin-chapter";

const props = withDefaults(
  defineProps<{
    option: {
      fullscreen?: boolean;
      url?: string;
      type?: string;
      autoplay?: boolean;
      string?: any;
      plugins?: {
        heatmap?: {
          data?: any[];
          option?: {
            sampling?: number;
            height?: number;
            color?: string;
            fillColor?: string;
          };
        };
        timestamp?: {
          position?: { top?: string; bottom?: string; left?: string; right?: string };
          visible?: boolean;
          timestamp?: number;
        };
        subtitle?: {
          subtitles?: Array<{
            url?: string;
            content?: string;
            name: string;
            type?: "srt" | "ass" | "vtt";
            encoding?: string;
          }>;
        };
      };
    };
    plugins?: string[];
    isLive?: boolean;
    watchSource?: WatchSource;
  }>(),
  {
    isLive: false,
  },
);
const emits = defineEmits<{
  (event: "ready", value: Artplayer): void;
  (event: "error", value: { error: any; reconnectTime: number }): void;
  (event: "seek", value: number): void;
  (event: "video:durationchange", value: number): void;
  (event: "video:canplay", value: Artplayer): void;
  (event: "finished"): void;
  (event: "watch-state", state: WatchState | null): void;
}>();

const artRef = ref<HTMLDivElement | null>(null);
let instance: Artplayer | null = null;
const video = shallowRef<Artplayer | null>(null);
let destroyed = false;
const {
  state: watchState,
  message: watchMessage,
  resumeAvailable,
  attach,
  resume,
  restart,
  mark,
  persist,
  reload: reloadProgress,
  ready: progressReady,
} = useWatchProgress(
  computed(() => props.watchSource),
  () => emits("finished"),
);
watch(watchState, (state) => emits("watch-state", state));

onMounted(async () => {
  const plugins: any[] = [];
  if (props.plugins) {
    if (props.plugins.includes("danmuku")) {
      plugins.push(
        artplayerPluginDanmuku({
          danmuku: [],
          emitter: false,
          heatmap: false,
          fontSize: 16,
          speed: 10, // 插件以穿过屏幕的秒数表示速度：10 对应「极慢」。
        }),
      );
    }
    if (props.plugins.includes("ass")) {
      plugins.push(
        artplayerPluginAssJS({
          content: "",
        }),
      );
    }
    if (props.plugins.includes("hls")) {
      plugins.push(
        artplayerPluginHlsControl({
          quality: {
            // Show qualitys in control
            control: false,
            // Show qualitys in setting
            setting: false,
            // Get the quality name from level
            // I18n
            title: "Quality",
            auto: "Auto",
          },
          audio: {
            // Show audios in control
            control: false,
            // Show audios in setting
            setting: false,
            // Get the audio name from track
            // I18n
            title: "Audio",
            auto: "Auto",
          },
        }),
      );
    }
    if (props.plugins.includes("heatmap")) {
      plugins.push(artplayerPluginHeatmap([], props?.option?.plugins?.heatmap?.option ?? {}));
    }
    if (props.plugins.includes("timestamp")) {
      plugins.push(
        artplayerPluginTimestamp({
          position: { top: "10px", right: "10px" },
          visible: false,
          timestamp: 0,
          ...props?.option?.plugins?.timestamp,
        }),
      );
    }
    if (props.plugins.includes("subtitle")) {
      const plugin = await artplayerPluginSubtitle({
        subtitles: props?.option?.plugins?.subtitle?.subtitles || [],
      });
      plugins.push(plugin);
    }
    if (props.plugins.includes("chapter")) {
      plugins.push(artplayerPluginChapter({}));
    }
  } else {
    plugins.push(
      artplayerPluginAssJS({
        content: "",
      }),
    );
  }
  if (destroyed) return;
  if (artRef.value === null) {
    console.error("artRef is null");
    return;
  }
  instance = new Artplayer({
    url: props?.option?.url ?? "",
    type: props?.option?.type ?? "",
    isLive: props.isLive,
    setting: true,
    playbackRate: props.isLive ? false : true,
    autoplay: props.isLive ? true : false,
    playsInline: true,
    ...props.option,
    container: artRef.value,
    plugins: plugins,
    subtitle: {
      style: {
        fontSize: "30px",
      },
    },
    // setting: true,
    // playbackRate: true,
    customType: {
      flv: (video, url, art) => {
        if (destroyed) return;
        if (mpegts.isSupported()) {
          clearTransports(art);

          const flv = mpegts.createPlayer({
            type: "flv",
            url: url,
            isLive: props.isLive,
          });
          flv.attachMediaElement(video);
          flv.load();

          art.flv = flv;
        } else {
          art.notice.show = "Unsupported playback format: flv";
        }
      },
      m3u8: function playM3u8(video, url, art) {
        if (destroyed) return;
        if (Hls.isSupported()) {
          clearTransports(art);
          const hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(video);
          art.hls = hls;
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = url;
        } else {
          art.notice.show = "Unsupported playback format: m3u8";
        }
      },
      ts: function play(video, url, art) {
        if (destroyed) return;
        const duration = 5;
        const tsFile = url;
        const m3u8Content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${duration}
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:${duration},
${tsFile}
#EXT-X-ENDLIST`;

        const blob = new Blob([m3u8Content], { type: "application/vnd.apple.mpegurl" });
        const m3u8URL = URL.createObjectURL(blob);

        if (Hls.isSupported()) {
          clearTransports(art);
          const hls = new Hls();
          hls.loadSource(m3u8URL);
          hls.attachMedia(video);
          art.hls = hls;
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = url;
        } else {
          art.notice.show = "Unsupported playback format: m3u8";
        }
      },
    },
  });
  video.value = instance;
  instance.on("destroy", () => {
    if (instance) clearTransports(instance);
  });
  await nextTick();

  // @ts-ignore
  instance.artplayerPluginSubtitle = instance?.plugins?.artplayerPluginSubtitle;
  // @ts-ignore
  instance.artplayerPluginDanmuku = instance?.plugins?.artplayerPluginDanmuku;
  // @ts-ignore
  instance.artplayerPluginHeatmap = instance?.plugins?.artplayerPluginHeatmap;
  // @ts-ignore
  instance.artplayerTimestamp = instance?.plugins?.artplayerTimestamp;
  // @ts-ignore
  instance.artplayerPluginChapter = instance?.plugins?.artplayerPluginChapter;

  // console.log("Artplayer instance created:", instance);

  setTimeout(() => {
    if (destroyed || !instance) return;
    // TODO:这里可能未来会出现问题，artplayerPluginSubtitle是异步插件
    // @ts-ignore
    instance.artplayerPluginSubtitle = instance?.plugins?.artplayerPluginSubtitle;
  }, 1000);
  await nextTick();
  if (destroyed) return;
  attach(instance);
  emits("ready", instance);
  instance.on("error", (error, reconnectTime) => {
    emits("error", { error, reconnectTime });
  });
  instance.on("seek", (currentTime) => {
    emits("seek", currentTime);
  });
  instance.on("video:durationchange", () => {
    const duration = Number(instance!.duration);
    emits("video:durationchange", duration);
  });
  instance.on("video:canplay", () => {
    emits("video:canplay", instance!);
  });
});

const switchUrl = async (url: string, type: "" | "flv" | "m3u8" = "") => {
  if (instance) {
    instance.type = type;
    instance?.switchUrl(url);
  } else {
    console.error("instance is null");
  }
};

const switchAss = async (subtitle?: string) => {
  if (instance) {
    // @ts-ignore
    instance.plugins.artplayerPluginAssJS.switch(subtitle || "");
  }
};

const switchDanmuku = async (danmuku: any[]) => {
  if (instance) {
    // @ts-ignore
    instance.plugins.artplayerPluginDanmuku.config({
      danmuku: danmuku,
    });
    // @ts-ignore
    instance.plugins.artplayerPluginDanmuku.load();
  }
};

// subtitle
const switchSubtitle = async (names: string[]) => {
  if (instance && instance.plugins.artplayerPluginSubtitle) {
    // @ts-ignore
    instance.plugins.artplayerPluginSubtitle.tracks(names);
  }
};

const resetSubtitle = async () => {
  if (instance && instance.plugins.artplayerPluginSubtitle) {
    // @ts-ignore
    instance.plugins.artplayerPluginSubtitle.reset();
  }
};

const setSubtitleContent = async (content: string) => {
  if (instance && instance.plugins.artplayerPluginSubtitle) {
    // @ts-ignore
    instance.plugins.artplayerPluginSubtitle.setContent(content);
  }
};

// Keep the video element, fullscreen/PiP state and browser playback permission across episodes.
function clearTransports(art: Artplayer) {
  const media = art as Artplayer & { flv?: { destroy(): void }; hls?: { destroy(): void } };
  media.flv?.destroy();
  media.hls?.destroy();
  media.flv = undefined;
  media.hls = undefined;
}
function replaceMedia(url: string, type: string) {
  if (!instance) throw new Error("播放器尚未就绪");
  instance.pause();
  if (instance.option.url === url && instance.type === type) return;
  clearTransports(instance);
  instance.template.$video.defaultPlaybackRate = instance.playbackRate;
  instance.type = type;
  instance.url = url;
}

defineExpose({
  persist,
  replaceMedia,
  progressReady,
  reloadProgress,
  switchUrl,
  video,
  switchAss,
  switchDanmuku,
  switchSubtitle,
  resetSubtitle,
  setSubtitleContent,
});

onBeforeUnmount(() => {
  destroyed = true;
  video.value = null;
  if (instance && instance.destroy) {
    instance.destroy(false);
  }
});
</script>

<style lang="less">
.artplayer {
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1;
}

.artplayer-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.watch-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  background: var(--watch-surface);
  color: var(--watch-text);
  font-size: 13px;
}
.watch-message {
  color: var(--watch-secondary);
  font-size: 12px;
}

.artplayer .ASS-box {
  z-index: 21;
}
</style>
