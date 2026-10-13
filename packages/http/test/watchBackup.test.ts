import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { once } from "node:events";
import type { Server } from "node:http";
import Koa from "koa";
import JSZip from "jszip";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const Database = createRequire(new URL("../../shared/package.json", import.meta.url))(
  "better-sqlite3",
);
const deps = vi.hoisted(() => ({
  root: "",
  db: null as any,
  store: null as any,
  reconnect: () => {},
}));
vi.mock("@biliLive-tools/shared/db/index.js", () => ({
  backupDB: (file: string) => deps.db.backup(file),
  backupWatchDB: (file: string) => deps.store.backup(file),
  closeDB: () => {
    deps.db.close();
    deps.store.close();
  },
  reconnectDB: () => deps.reconnect(),
}));
vi.mock("@biliLive-tools/shared/utils/index.js", () => ({
  getTempPath: () => path.join(deps.root, "temp"),
}));
vi.mock("@biliLive-tools/shared/notify.js", () => ({ _send: vi.fn() }));
vi.mock("../src/index.js", () => ({
  appConfig: { getAll: () => ({}) },
  container: {
    resolve: (name: string) =>
      name === "videoPreset"
        ? { list: async () => [] }
        : {
            userDataPath: path.join(deps.root, "data"),
            configPath: path.join(deps.root, "data/appConfig.json"),
            videoPresetPath: path.join(deps.root, "data/presets.json"),
            danmuPresetPath: path.join(deps.root, "data/danmu_presets.json"),
            ffmpegPresetPath: path.join(deps.root, "data/ffmpeg_presets.json"),
          },
  },
}));
import { WatchHistoryStore } from "../../shared/src/db/watchHistory.js";
import router from "../src/routes/config.js";

describe("watch history archive compatibility", () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    deps.root = fs.mkdtempSync(path.join(os.tmpdir(), "watch-backup-"));
    fs.mkdirSync(path.join(deps.root, "data"));
    fs.mkdirSync(path.join(deps.root, "temp"));
    fs.writeFileSync(
      path.join(deps.root, "data/appConfig.json"),
      JSON.stringify({ webhook: {}, recorder: {}, legacy: true }),
    );
    deps.reconnect = () => {
      deps.db = new Database(path.join(deps.root, "data/app.db"));
      deps.store = new WatchHistoryStore(path.join(deps.root, "data"));
    };
    deps.reconnect();
    deps.db.exec("CREATE TABLE legacy (title TEXT); INSERT INTO legacy VALUES ('原录制记录')");
    deps.store.ensure({ key: "file:fixture", filePath: "/video.mp4", title: "录像" });
    deps.store.update("file:fixture", {
      revision: 0,
      action: "progress",
      position: 66,
      duration: 120,
    });
    const app = new Koa();
    app.use(router.routes());
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as any).port}/config`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    deps.store.close();
    deps.db.close();
    fs.rmSync(deps.root, { recursive: true, force: true });
  });
  async function exported() {
    const response = await fetch(`${base}/export`);
    expect(response.status).toBe(200);
    return JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
  }
  async function restore(zip: JSZip) {
    const form = new FormData();
    form.append("file", new Blob([await zip.generateAsync({ type: "nodebuffer" })]), "backup.zip");
    return fetch(`${base}/import`, { method: "POST", body: form });
  }
  it("exports committed progress and restores it without changing legacy records", async () => {
    const zip = await exported();
    expect(zip.file("watch-history.db")).not.toBeNull();
    deps.store.update("file:fixture", { revision: 1, action: "unwatched" });
    expect((await restore(zip)).status).toBe(200);
    expect(deps.store.get("file:fixture")).toMatchObject({ position: 66, revision: 1 });
    expect(deps.db.prepare("SELECT * FROM legacy").all()).toEqual([{ title: "原录制记录" }]);
  });
  it("imports legacy archives without clearing newer watch data", async () => {
    const zip = await exported();
    zip.remove("watch-history.db");
    expect((await restore(zip)).status).toBe(200);
    expect(deps.store.get("file:fixture")?.position).toBe(66);
    expect(deps.db.prepare("SELECT * FROM legacy").all()).toEqual([{ title: "原录制记录" }]);
  });
  it("rejects a corrupt optional DB before applying any archive contents", async () => {
    const zip = await exported();
    zip.file("watch-history.db", "corrupted");
    zip.file("appConfig.json", JSON.stringify({ webhook: {}, recorder: {}, legacy: false }));
    const config = fs.readFileSync(path.join(deps.root, "data/appConfig.json"));
    expect((await restore(zip)).status).toBe(400);
    expect(fs.readFileSync(path.join(deps.root, "data/appConfig.json"))).toEqual(config);
    expect(deps.store.get("file:fixture")?.position).toBe(66);
  });
});
