import { ref, watch, onBeforeUnmount, type Ref } from "vue";
import type Artplayer from "artplayer";
import watchApi, {
  keepaliveUpdate,
  type WatchAction,
  type WatchSource,
  type WatchState,
} from "@renderer/apis/watchHistory";
import request from "@renderer/apis/request";

export function useWatchProgress(source: Ref<WatchSource | undefined>, onFinished?: () => void) {
  const state = ref<WatchState | null>(null);
  const resumeAvailable = ref(false);
  const message = ref("");
  let player: Artplayer | null = null;
  let active = false;
  let disposed = false;
  let saving = false;
  let inFlight: Promise<void> | null = null;
  let generation = 0;
  let dirty = false;
  let lastSave = 0;
  let queuedAction: WatchAction | null = null;
  let conflicted = false;
  let endedGeneration = -1;
  let resolving: Promise<void> = Promise.resolve();
  let pendingPosition: number | null = null;
  const pendingKey = () =>
    `watch-pending:${request.defaults.baseURL || "local"}:${state.value?.key}`;

  const payload = (action: WatchAction) => ({
    revision: state.value!.revision,
    action,
    position:
      !active || resumeAvailable.value
        ? state.value!.position
        : pendingPosition !== null
          ? pendingPosition
          : Number.isFinite(player?.currentTime)
            ? Math.max(0, player!.currentTime)
            : state.value!.position,
    duration:
      Number.isFinite(player?.duration) && player!.duration > 0
        ? player!.duration
        : state.value!.duration,
  });

  async function save(action: WatchAction = "progress") {
    if (
      !state.value ||
      !player ||
      disposed ||
      (action === "progress" && (!active || resumeAvailable.value || conflicted))
    )
      return;
    if (saving) {
      dirty = true;
      if (action !== "progress") queuedAction = action;
      if (action !== "progress") await inFlight;
      return;
    }
    const operation = write(action);
    inFlight = operation;
    await operation;
    if (inFlight === operation) inFlight = null;
  }

  async function write(action: WatchAction) {
    saving = true;
    lastSave = Date.now();
    dirty = false;
    const key = state.value!.key;
    const update = payload(action);
    const currentGeneration = generation;
    try {
      window.localStorage.setItem(pendingKey(), JSON.stringify(update));
    } catch {}
    try {
      const result = await watchApi.update(key, update);
      if (currentGeneration !== generation || disposed) return;
      state.value = result.state;
      lastSave = Date.now();
      try {
        window.localStorage.removeItem(pendingKey());
      } catch {}
      if (result.conflict) {
        active = false;
        dirty = false;
        queuedAction = null;
        conflicted = true;
        message.value = "其他页面已更新进度，请重新打开视频后继续同步";
      } else {
        message.value = "进度已保存";
        window.dispatchEvent(new Event("watch-history-updated"));
      }
    } catch {
      if (currentGeneration === generation) {
        message.value = "进度暂未同步，联网后将重试";
        try {
          window.localStorage.setItem(pendingKey(), JSON.stringify(update));
        } catch {}
      }
    } finally {
      saving = false;
      if (currentGeneration === generation && queuedAction) {
        const next = queuedAction;
        queuedAction = null;
        await save(next);
      } else if (currentGeneration === generation && dirty && Date.now() - lastSave >= 5000) {
        void save();
      }
    }
  }

  async function load() {
    const current = ++generation;
    state.value = null;
    active = false;
    resumeAvailable.value = false;
    conflicted = false;
    dirty = false;
    queuedAction = null;
    pendingPosition = null;
    if (!source.value?.recordId && !source.value?.videoId) return;
    try {
      let data = await watchApi.resolve(source.value);
      if (current !== generation || disposed) return;
      state.value = data;
      try {
        const pending = JSON.parse(window.localStorage.getItem(pendingKey()) || "null");
        if (pending && pending.revision === data.revision) {
          data = (await watchApi.update(data.key, pending)).state;
          if (current !== generation || disposed) return;
          state.value = data;
          window.localStorage.removeItem(pendingKey());
        } else if (pending) {
          window.localStorage.removeItem(pendingKey());
        }
      } catch {}
      resumeAvailable.value = data.position > 3 && !data.completed;
      if (player?.playing) {
        if (resumeAvailable.value) {
          seekTo(data.position);
          resumeAvailable.value = false;
        }
        active = true;
      }
      message.value = "";
    } catch {
      message.value = "观看进度不可用，仍可播放视频";
    }
  }

  async function restart() {
    if (!player || !state.value) return;
    resumeAvailable.value = false;
    active = true;
    conflicted = false;
    seekTo(0);
    await save("restart");
    await player.play();
  }

  async function mark() {
    const action = state.value?.completed ? "unwatched" : "completed";
    if (action === "unwatched") {
      active = false;
      player?.pause();
    }
    await save(action);
  }

  async function resume() {
    if (!player || !state.value) return;
    seekTo(state.value.position);
    resumeAvailable.value = false;
    active = true;
    await player.play();
  }

  function seekTo(position: number) {
    if (!player) return;
    const instance = player;
    const current = generation;
    if (
      Number.isFinite(instance.duration) &&
      instance.duration > 0 &&
      instance.template?.$video?.readyState !== 0
    ) {
      pendingPosition = null;
      instance.currentTime = Math.min(position, instance.duration);
    } else {
      pendingPosition = position;
      instance.once("video:loadedmetadata", () => {
        if (!disposed && player === instance && current === generation) {
          instance.currentTime =
            Number.isFinite(instance.duration) && instance.duration > 0
              ? Math.min(position, instance.duration)
              : position;
          pendingPosition = null;
        }
      });
    }
  }

  function attach(instance: Artplayer) {
    player = instance;
    const begin = () => {
      endedGeneration = -1;
      if (!state.value) return;
      // If the user plays without choosing, preserve their previous place by resuming.
      if (resumeAvailable.value) {
        seekTo(state.value.position);
        resumeAvailable.value = false;
      }
      active = true;
    };
    instance.on("video:play", begin);
    instance.on("video:playing", begin);
    if (instance.playing) begin();
    instance.on("video:timeupdate", () => {
      if (active && Date.now() - lastSave >= 5000) void save();
    });
    instance.on("video:pause", () => {
      void save();
    });
    instance.on("video:seeked", () => {
      if (active) void save();
    });
    instance.on("video:ended", () => {
      const current = generation;
      if (endedGeneration === current) return;
      endedGeneration = current;
      void (async () => {
        if (active && state.value && !conflicted) await save("completed");
        if (disposed || current !== generation) return;
        active = false;
        onFinished?.();
      })();
    });
  }

  async function persist() {
    player?.pause();
    if (inFlight) await inFlight;
    if (active && !resumeAvailable.value && !conflicted) await save();
    active = false;
  }

  function flush() {
    if (!state.value || !active || resumeAvailable.value || conflicted || !player || saving) return;
    const update = payload("progress");
    try {
      window.localStorage.setItem(pendingKey(), JSON.stringify(update));
    } catch {}
    void keepaliveUpdate(state.value.key, update).catch(() => {});
  }
  const visibility = () => {
    if (document.visibilityState === "hidden") flush();
  };
  const retry = () => {
    void save();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", flush);
  window.addEventListener("online", retry);
  const reload = () => (resolving = load());
  watch(
    () =>
      source.value?.recordId
        ? `record:${source.value.recordId}`
        : `file:${source.value?.videoId || ""}`,
    () => {
      void reload();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    flush();
    disposed = true;
    generation++;
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("online", retry);
  });

  return {
    state,
    message,
    resumeAvailable,
    attach,
    resume,
    restart,
    mark,
    persist,
    reload,
    ready: () => resolving,
  };
}
