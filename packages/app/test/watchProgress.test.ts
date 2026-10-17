// @vitest-environment node
import { createRenderer, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Artplayer from "artplayer";
const api = vi.hoisted(() => ({ resolve: vi.fn(), update: vi.fn(), keepalive: vi.fn() }));
vi.mock("@renderer/apis/watchHistory", () => ({ default: api, keepaliveUpdate: api.keepalive }));
vi.mock("@renderer/apis/request", () => ({ default: { defaults: { baseURL: "http://backend" } } }));
import { useWatchProgress } from "../src/renderer/src/hooks/useWatchProgress";

class Player {
  currentTime = 0;
  duration = 1000;
  playing = false;
  listeners = new Map<string, Array<() => void>>();
  on(name: string, fn: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), fn]);
  }
  once(name: string, fn: () => void) {
    this.on(name, fn);
  }
  emit(name: string) {
    this.listeners.get(name)?.forEach((fn) => fn());
  }
  async play() {
    this.playing = true;
    this.emit("video:play");
  }
  pause() {
    this.playing = false;
    this.emit("video:pause");
  }
}
const initial = (key = "record:one") => ({
  key,
  filePath: "/video.mp4",
  title: "录像",
  position: 52,
  duration: 1000,
  completed: false,
  revision: 0,
  updatedAt: 0,
  lastPlayedAt: 1,
});

describe("watch progress lifecycle", () => {
  let app: ReturnType<typeof renderer.createApp>;
  let windowTarget: EventTarget & { localStorage: any };
  let documentTarget: EventTarget & { visibilityState: string };
  const renderer = createRenderer<any, any>({
    insert: () => {},
    remove: () => {},
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: () => {},
  });
  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>();
    windowTarget = Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => values.get(key) || null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("document", documentTarget);
    api.resolve.mockResolvedValue(initial());
    const commit = async (key: string, update: any) => ({
      conflict: false,
      state: {
        ...initial(key),
        ...update,
        position: ["unwatched", "restart"].includes(update.action) ? 0 : update.position,
        completed: update.action === "completed",
        revision: update.revision + 1,
      },
    });
    api.update.mockImplementation(commit);
    api.keepalive.mockImplementation(commit);
  });
  afterEach(() => {
    app?.unmount();
    vi.unstubAllGlobals();
  });
  function mount(source = ref({ recordId: 1 }), onFinished?: () => void) {
    let progress!: ReturnType<typeof useWatchProgress>;
    app = renderer.createApp({
      setup() {
        progress = useWatchProgress(source, onFinished);
        return () => null;
      },
    });
    app.mount({});
    const player = new Player();
    progress.attach(player as unknown as Artplayer);
    return { progress, player, source };
  }

  it("does not overwrite saved progress during startup and resumes before saving", async () => {
    const { progress, player } = mount();
    await vi.waitFor(() => expect(progress.resumeAvailable.value).toBe(true));
    player.emit("video:timeupdate");
    player.emit("video:pause");
    expect(api.update).not.toHaveBeenCalled();
    await progress.resume();
    expect(player.currentTime).toBe(52);
    player.currentTime = 58;
    player.emit("video:timeupdate");
    await vi.waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        "record:one",
        expect.objectContaining({ position: 58, revision: 0, action: "progress" }),
      ),
    );
  });

  it("resumes when autoplay has already started before listeners attach", async () => {
    const { progress } = mount();
    await vi.waitFor(() => expect(progress.state.value).not.toBeNull());
    const early = new Player();
    early.playing = true;
    progress.attach(early as unknown as Artplayer);
    expect(early.currentTime).toBe(52);
    expect(progress.resumeAvailable.value).toBe(false);
    early.currentTime = 57;
    early.emit("video:timeupdate");
    await vi.waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        "record:one",
        expect.objectContaining({ position: 57 }),
      ),
    );
  });

  it("keeps failed progress locally and retries after reconnecting", async () => {
    const { progress, player } = mount();
    await vi.waitFor(() => expect(progress.state.value).not.toBeNull());
    api.update.mockRejectedValueOnce(new Error("offline"));
    await progress.resume();
    player.currentTime = 66;
    player.pause();
    await vi.waitFor(() =>
      expect(
        windowTarget.localStorage.getItem("watch-pending:http://backend:record:one"),
      ).not.toBeNull(),
    );
    windowTarget.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(progress.state.value?.position).toBe(66));
    expect(windowTarget.localStorage.getItem("watch-pending:http://backend:record:one")).toBeNull();
  });

  it("does not let a late lookup replace the next video's state", async () => {
    let resolveFirst!: (value: any) => void;
    api.resolve.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const { progress, source } = mount();
    api.resolve.mockResolvedValueOnce(initial("record:two"));
    source.value = { recordId: 2 };
    await vi.waitFor(() => expect(progress.state.value?.key).toBe("record:two"));
    resolveFirst(initial("record:one"));
    await Promise.resolve();
    expect(progress.state.value?.key).toBe("record:two");
  });

  it("does not reload progress when the parent renders an equivalent source object", async () => {
    const { progress, source, player } = mount();
    await vi.waitFor(() => expect(progress.state.value).not.toBeNull());
    await progress.resume();
    source.value = { recordId: 1 };
    await Promise.resolve();
    await Promise.resolve();
    expect(api.resolve).toHaveBeenCalledOnce();
    expect(progress.resumeAvailable.value).toBe(false);
    expect(player.currentTime).toBe(52);
  });

  it("flushes on backgrounding and removes lifecycle handlers on unmount", async () => {
    const { progress, player } = mount();
    await vi.waitFor(() => expect(progress.state.value).not.toBeNull());
    await progress.resume();
    player.currentTime = 75;
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(api.keepalive).toHaveBeenCalledWith(
      "record:one",
      expect.objectContaining({ position: 75 }),
    );
    app.unmount();
    api.keepalive.mockClear();
    api.update.mockClear();
    windowTarget.dispatchEvent(new Event("pagehide"));
    windowTarget.dispatchEvent(new Event("online"));
    expect(api.keepalive).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
  });

  it("continues saving after a mobile fullscreen/background flush advances the server revision", async () => {
    let stored = initial();
    const commit = async (key: string, update: any) => {
      if (update.revision !== stored.revision) return { conflict: true, state: { ...stored } };
      stored = { ...stored, ...update, key, revision: stored.revision + 1 };
      return { conflict: false, state: { ...stored } };
    };
    api.update.mockImplementation(commit);
    api.keepalive.mockImplementation(commit);
    const { progress, player } = mount();
    await progress.ready();
    await progress.resume();
    player.currentTime = 75;
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(stored.position).toBe(75));
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    player.currentTime = 80;
    player.pause();
    await vi.waitFor(() => expect(progress.state.value?.position).toBe(80));
    expect(progress.message.value).not.toContain("其他页面");
    await player.play();
    player.currentTime = 90;
    player.emit("video:seeked");
    await vi.waitFor(() => expect(stored.position).toBe(90));
  });

  it("serializes background, pagehide and foreground saves using the acknowledged revision", async () => {
    let finish!: (result: any) => void;
    api.keepalive.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { progress, player } = mount();
    await progress.ready();
    await progress.resume();
    player.currentTime = 75;
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    player.currentTime = 77;
    windowTarget.dispatchEvent(new Event("pagehide"));
    player.emit("video:seeked");
    expect(api.keepalive).toHaveBeenCalledOnce();
    expect(api.update).not.toHaveBeenCalled();
    finish({ conflict: false, state: { ...initial(), position: 75, revision: 1 } });
    await vi.waitFor(() => expect(progress.state.value?.position).toBe(77));
    expect(api.keepalive.mock.calls[1]?.[1]).toMatchObject({ revision: 1, position: 77 });
    player.currentTime = 80;
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(progress.state.value?.position).toBe(80));
    expect(api.update.mock.calls[0]?.[1]).toMatchObject({ revision: 2, position: 80 });
  });

  it("does not drop a paused position while an earlier save is still in flight", async () => {
    let finish!: (result: any) => void;
    api.update.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { progress, player } = mount();
    await progress.ready();
    await progress.resume();
    player.currentTime = 60;
    player.emit("video:timeupdate");
    player.currentTime = 80;
    player.pause();
    expect(api.update).toHaveBeenCalledOnce();
    finish({ conflict: false, state: { ...initial(), position: 60, revision: 1 } });
    await vi.waitFor(() => expect(progress.state.value?.position).toBe(80));
    expect(api.update.mock.calls[1]?.[1]).toMatchObject({ revision: 1, position: 80 });
  });

  it("retries a failed background save without losing the pending position", async () => {
    api.keepalive.mockRejectedValueOnce(new Error("offline"));
    const { progress, player } = mount();
    await progress.ready();
    await progress.resume();
    player.currentTime = 83;
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(progress.message.value).toContain("联网"));
    expect(
      JSON.parse(windowTarget.localStorage.getItem("watch-pending:http://backend:record:one")),
    ).toMatchObject({ position: 83 });
    windowTarget.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(progress.state.value?.position).toBe(83));
  });

  it("still respects a real revision conflict returned by a background save", async () => {
    api.keepalive.mockResolvedValueOnce({
      conflict: true,
      state: { ...initial(), position: 200, revision: 7 },
    });
    const { progress, player } = mount();
    await progress.ready();
    await progress.resume();
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(progress.message.value).toContain("其他页面"));
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    player.emit("fullscreen");
    player.currentTime = 600;
    player.pause();
    expect(api.update).not.toHaveBeenCalled();
    expect(progress.state.value?.position).toBe(200);
  });

  it("recovers when the server saved background progress but its acknowledgement was lost", async () => {
    let stored = initial();
    api.keepalive.mockImplementationOnce(async (_key, update) => {
      stored = { ...stored, ...update, revision: update.revision + 1 };
      throw new Error("response timed out after commit");
    });
    api.update.mockImplementation(async (_key, update) => {
      if (update.revision !== stored.revision) return { conflict: true, state: { ...stored } };
      stored = { ...stored, ...update, revision: update.revision + 1 };
      return { conflict: false, state: { ...stored } };
    });
    const { progress, player } = mount();
    await progress.ready();
    await progress.resume();
    player.currentTime = 75;
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(progress.message.value).toContain("联网"));
    player.currentTime = 80;
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(stored.position).toBe(80));
    expect(progress.message.value).not.toContain("其他页面");
    expect(progress.state.value?.revision).toBe(2);
  });

  it("does not mistake a different page's write for a lost acknowledgement", async () => {
    api.keepalive.mockRejectedValueOnce(new Error("offline"));
    const { progress, player } = mount();
    await progress.ready();
    await progress.resume();
    player.currentTime = 75;
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(progress.message.value).toContain("联网"));
    api.update.mockResolvedValueOnce({
      conflict: true,
      state: { ...initial(), position: 200, revision: 1 },
    });
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(progress.message.value).toContain("其他页面"));
    expect(api.update).toHaveBeenCalledOnce();
    expect(progress.state.value?.position).toBe(200);
  });

  it("waits for an in-flight background save before completing and advancing", async () => {
    let finish!: (result: any) => void;
    api.keepalive.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const ended = vi.fn();
    const { progress, player } = mount(undefined, ended);
    await progress.ready();
    await progress.resume();
    player.currentTime = 75;
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    player.currentTime = 1000;
    player.emit("video:ended");
    expect(ended).not.toHaveBeenCalled();
    finish({ conflict: false, state: { ...initial(), position: 75, revision: 1 } });
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
    expect(api.update.mock.calls.at(-1)?.[1]).toMatchObject({ action: "completed", revision: 1 });
    expect(progress.state.value?.completed).toBe(true);
  });

  it("stops automatic saves after another page wins a revision conflict", async () => {
    const { progress, player } = mount();
    await vi.waitFor(() => expect(progress.state.value).not.toBeNull());
    await progress.resume();
    api.update.mockResolvedValueOnce({
      conflict: true,
      state: { ...initial(), position: 200, revision: 7 },
    });
    player.pause();
    await vi.waitFor(() => expect(progress.message.value).toContain("其他页面"));
    await player.play();
    player.currentTime = 600;
    player.emit("video:seeked");
    player.emit("video:ended");
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it("marks completion on ended and pauses when explicitly marking unwatched", async () => {
    const { progress, player } = mount();
    await vi.waitFor(() => expect(progress.state.value).not.toBeNull());
    await progress.resume();
    player.currentTime = 1000;
    player.emit("video:ended");
    await vi.waitFor(() => expect(progress.state.value?.completed).toBe(true));
    await progress.mark();
    expect(progress.state.value?.position).toBe(0);
    expect(player.playing).toBe(false);
    const count = api.update.mock.calls.length;
    player.emit("video:timeupdate");
    player.emit("video:pause");
    expect(api.update).toHaveBeenCalledTimes(count);
  });

  it("waits for queued completion before advancing to the next episode", async () => {
    const ended = vi.fn();
    const { progress, player } = mount(undefined, ended);
    await vi.waitFor(() => expect(progress.state.value).not.toBeNull());
    await progress.resume();
    let finishProgress!: (result: any) => void;
    api.update.mockReturnValueOnce(
      new Promise((resolve) => {
        finishProgress = resolve;
      }),
    );
    player.currentTime = 60;
    player.emit("video:timeupdate");
    player.currentTime = 1000;
    player.emit("video:ended");
    expect(ended).not.toHaveBeenCalled();
    finishProgress({ conflict: false, state: { ...initial(), position: 60, revision: 1 } });
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
    expect(api.update.mock.calls.at(-1)?.[1]).toMatchObject({
      action: "completed",
      revision: 1,
      position: 1000,
    });
    expect(progress.state.value?.completed).toBe(true);
  });

  it("preserves offline completion when the old episode unmounts", async () => {
    const ended = vi.fn();
    const { progress, player } = mount(undefined, ended);
    await vi.waitFor(() => expect(progress.state.value).not.toBeNull());
    await progress.resume();
    api.update.mockRejectedValueOnce(new Error("offline"));
    player.currentTime = 1000;
    player.emit("video:ended");
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
    app.unmount();
    expect(
      JSON.parse(windowTarget.localStorage.getItem("watch-pending:http://backend:record:one"))
        .action,
    ).toBe("completed");
    expect(api.keepalive).not.toHaveBeenCalled();
  });

  it("pauses and saves the newest position before manually switching episodes", async () => {
    const { progress, player } = mount();
    await vi.waitFor(() => expect(progress.state.value).not.toBeNull());
    await progress.resume();
    player.currentTime = 71;
    await progress.persist();
    expect(progress.state.value?.position).toBe(71);
    expect(player.playing).toBe(false);
    app.unmount();
    expect(api.keepalive).not.toHaveBeenCalled();
  });

  it("rebinds progress on the same video without leaking the previous segment's position", async () => {
    const { progress, player, source } = mount();
    await progress.ready();
    await progress.resume();
    player.currentTime = 73;
    await progress.persist();
    api.resolve.mockResolvedValueOnce({ ...initial("record:two"), position: 210 });
    source.value = { recordId: 2 };
    await nextTick();
    await progress.ready();
    player.currentTime = 0;
    await player.play();
    expect(player.currentTime).toBe(210);
    player.currentTime = 218;
    player.pause();
    await vi.waitFor(() => expect(progress.state.value?.position).toBe(218));
    expect(api.update.mock.calls.at(-1)?.[0]).toBe("record:two");
    expect(
      api.update.mock.calls.find(([key, value]) => key === "record:one" && value.position === 73),
    ).toBeTruthy();
  });

  it("ignores a previous segment's delayed metadata seek after reusing the video", async () => {
    const { progress, player, source } = mount();
    await progress.ready();
    player.duration = NaN;
    await progress.resume();
    await progress.persist();
    api.resolve.mockResolvedValueOnce({ ...initial("record:two"), position: 210 });
    source.value = { recordId: 2 };
    await nextTick();
    await progress.ready();
    player.duration = 1000;
    player.currentTime = 0;
    player.emit("video:loadedmetadata");
    expect(player.currentTime).toBe(0);
    await player.play();
    expect(player.currentTime).toBe(210);
  });

  it("preserves the saved position if switching before resumed video metadata arrives", async () => {
    const { progress, player } = mount();
    await progress.ready();
    player.duration = NaN;
    await progress.resume();
    expect(player.currentTime).toBe(0);
    await progress.persist();
    expect(progress.state.value?.position).toBe(52);
    expect(api.update.mock.calls.at(-1)?.[1].position).toBe(52);
  });

  it("does not let a progress conflict disable continuous playback", async () => {
    const ended = vi.fn();
    const { progress, player } = mount(undefined, ended);
    await progress.ready();
    await progress.resume();
    api.update.mockResolvedValueOnce({ conflict: true, state: { ...initial(), revision: 7 } });
    player.pause();
    await vi.waitFor(() => expect(progress.message.value).toContain("其他页面"));
    player.emit("video:ended");
    player.emit("video:ended");
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
    expect(api.update).toHaveBeenCalledOnce();
  });

  it("advances once if a browser emits duplicate ended events while completion is saving", async () => {
    const ended = vi.fn();
    const { progress, player } = mount(undefined, ended);
    await progress.ready();
    await progress.resume();
    player.currentTime = 1000;
    player.emit("video:ended");
    player.emit("video:ended");
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
    expect(api.update.mock.calls.filter(([, value]) => value.action === "completed")).toHaveLength(
      1,
    );
  });
});
