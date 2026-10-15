import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import Koa from "koa";
import { bodyParser } from "@koa/bodyparser";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
const Database = createRequire(new URL("../../shared/package.json", import.meta.url))(
  "better-sqlite3",
);

const dependencies = vi.hoisted(() => ({
  db: null as any,
  store: null as any,
  files: new Map<string, any>(),
}));
vi.mock("@biliLive-tools/shared/db/index.js", () => ({
  getMainDb: () => dependencies.db,
  get watchHistoryStore() {
    return dependencies.store;
  },
  recordHistoryService: {
    query: (query: any) => {
      const field = query.id ? "id" : "video_file";
      return dependencies.db
        .prepare(`SELECT * FROM record_history WHERE ${field} = ?`)
        .get(query[field]);
    },
  },
}));
vi.mock("../src/index.js", () => ({
  container: undefined,
  appConfig: { get: () => [] },
  fileCache: {
    get: (key: string) => dependencies.files.get(key),
    setFile: (file: string) => {
      dependencies.files.set("renewed", { path: file, expireAt: Date.now() + 10000 });
      return "renewed";
    },
  },
}));
import { WatchHistoryStore } from "../../shared/src/db/watchHistory.js";
import router from "../src/routes/watchHistory.js";

describe("watch history HTTP workflow against legacy recording data", () => {
  let directory: string;
  let server: Server;
  let base: string;
  let recordKey: string;
  let legacySchema: unknown;
  const request = (url: string, method = "GET", body?: unknown, auth = true) =>
    fetch(`${base}${url}`, {
      method,
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "test" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "watch-http-"));
    const video = path.join(directory, "record.mp4");
    fs.writeFileSync(video, Buffer.alloc(70000, 1));
    dependencies.db = new Database(path.join(directory, "app.db"));
    dependencies.db
      .exec(`CREATE TABLE streamer (id INTEGER PRIMARY KEY, name TEXT, platform TEXT, room_id TEXT);
      INSERT INTO streamer VALUES (1, '测试主播', 'bilibili', '1');
      CREATE TABLE record_history (id INTEGER PRIMARY KEY, streamer_id INTEGER, record_start_time INTEGER, live_id TEXT, title TEXT, video_file TEXT,
        live_start_time INTEGER, video_duration REAL);`);
    const insert = dependencies.db.prepare(
      "INSERT INTO record_history (id, streamer_id, record_start_time, title, video_file) VALUES (?, 1, ?, ?, ?)",
    );
    insert.run(1, 1000, "第一场", video);
    insert.run(2, 2000, "第二场", video);
    legacySchema = dependencies.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
    dependencies.store = new WatchHistoryStore(directory);
    dependencies.files.set("valid", { path: video, expireAt: Date.now() + 100000 });
    dependencies.files.set("expired", { path: video, expireAt: 1 });
    const app = new Koa();
    app.use(async (ctx, next) => {
      if (ctx.headers.authorization !== "test") {
        ctx.status = 401;
        return;
      }
      await next();
    });
    app.use(bodyParser());
    app.use(router.routes());
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as any).port}/watch-history`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    dependencies.store.close();
    dependencies.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("requires authentication and validates IDs and expiring playback tokens", async () => {
    expect((await request("/recent", "GET", undefined, false)).status).toBe(401);
    expect((await request("/resolve", "POST", {})).status).toBe(400);
    expect((await request("/resolve", "POST", { recordId: -1 })).status).toBe(400);
    expect((await request("/resolve", "POST", { videoId: "expired" })).status).toBe(404);
  });

  it("reads newly added recordings as unwatched without a schema migration", async () => {
    const result = await (await request("/library?status=unwatched&limit=1")).json();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 2, watch: null });
    const next = await (await request(`/library?before=${result.nextCursor}`)).json();
    expect(next.data.map((item: any) => item.id)).toEqual([1]);
    expect(dependencies.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(
      legacySchema,
    );
  });

  it("saves progress, guards conflicting writes and filters the full library", async () => {
    const initial = await (await request("/resolve", "POST", { recordId: 1 })).json();
    recordKey = initial.key;
    expect(
      (
        await request(`/${recordKey}`, "PUT", {
          revision: 0,
          action: "progress",
          position: 65,
          duration: 1000,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/${recordKey}`, "PUT", { revision: 0, action: "progress", position: 1 }))
        .status,
    ).toBe(409);
    const recent = await (await request("/recent")).json();
    expect(recent[0]).toMatchObject({ position: 65, revision: 1 });
    const library = await (await request("/library?status=watching&search=测试主播")).json();
    expect(library.data.map((item: any) => item.id)).toEqual([1]);
  });

  it("renews playback credentials and resets watched/unwatched state", async () => {
    expect((await (await request(`/${recordKey}/play`)).json()).videoId).toBe("renewed");
    await request(`/${recordKey}`, "PUT", { revision: 1, action: "completed" });
    expect(
      (await (await request("/library?status=completed")).json()).data.map((item: any) => item.id),
    ).toEqual([1]);
    await request(`/${recordKey}`, "PUT", { revision: 2, action: "unwatched" });
    expect((await (await request("/library?status=unwatched")).json()).data).toHaveLength(2);
    expect(await (await request("/recent?status=watching")).json()).toEqual([]);
  });

  it("rejects invalid progress without changing existing values", async () => {
    expect(
      (await request(`/${recordKey}`, "PUT", { revision: 3, action: "progress", position: -10 }))
        .status,
    ).toBe(400);
    expect((await request("/library?limit=10000")).status).toBe(400);
    expect((await (await request(`/${recordKey}`)).json()).position).toBe(0);
    expect(dependencies.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(
      legacySchema,
    );
  });
  it("file browser playback associates a reused file path with its newest recording", async () => {
    const watch = await (await request("/resolve", "POST", { videoId: "valid" })).json();
    expect(watch.recordId).toBe(2);
  });

  it("paginates entire sessions, searches all titles and counts all segments", async () => {
    dependencies.db.exec(
      "UPDATE record_history SET live_id = 'same-stream', live_start_time = 100 WHERE id IN (1, 2)",
    );
    // Changing the stable identity represents new recordings, initially unwatched.
    const library = await (await request("/sessions?limit=1&search=第一场")).json();
    expect(library.data).toHaveLength(1);
    expect(library.data[0]).toMatchObject({
      streamerId: 1,
      sessionKey: "live:same-stream",
      clipCount: 2,
      watch: { totalCount: 2, completedCount: 0, status: "unwatched" },
    });
    const clips = await (
      await request("/session-clips", "POST", {
        streamerId: 1,
        sessionKey: library.data[0].sessionKey,
      })
    ).json();
    expect(clips.data.map((item: any) => item.id)).toEqual([1, 2]);
    const first = await (await request("/resolve", "POST", { recordId: 1 })).json();
    await request(`/${first.key}`, "PUT", { revision: first.revision, action: "completed" });
    const partial = await (await request("/sessions?status=watching")).json();
    expect(partial.data[0].watch).toMatchObject({
      status: "watching",
      completedCount: 1,
      totalCount: 2,
    });
    expect((await (await request("/sessions?status=completed")).json()).data).toEqual([]);
    const second = await (await request("/resolve", "POST", { recordId: 2 })).json();
    await request(`/${second.key}`, "PUT", {
      revision: second.revision,
      action: "progress",
      position: 15,
    });
    const recent = await (await request("/sessions?recent=true&status=watching")).json();
    expect(recent.data).toHaveLength(1);
    expect(recent.data[0].clipCount).toBe(2);
    await request(`/${second.key}`, "PUT", { revision: second.revision + 1, action: "completed" });
    expect(
      (await (await request("/sessions?status=completed")).json()).data[0].watch.completed,
    ).toBe(true);
    expect((await (await request("/sessions?recent=true&status=watching")).json()).data).toEqual(
      [],
    );
    expect((await (await request(`/sessions?before=${library.nextCursor}`)).json()).data).toEqual(
      [],
    );
  });

  it("does not merge identical stream IDs belonging to different streamers", async () => {
    dependencies.db.exec(`INSERT INTO streamer VALUES (2, '另一主播', 'bilibili', '2');
      INSERT INTO record_history (id, streamer_id, record_start_time, live_id, title, video_file)
      VALUES (3, 2, 3000, 'same-stream', '第三场', '/missing.mp4')`);
    const result = await (await request("/sessions")).json();
    expect(result.data).toHaveLength(2);
    expect(new Set(result.data.map((item: any) => item.key)).size).toBe(2);
    expect(
      (await (await request(`/sessions?before=${result.data[0].cursor}&limit=1`)).json()).data[0]
        .clipCount,
    ).toBe(2);
    expect((await request("/sessions?limit=10000")).status).toBe(400);
    expect(
      (await request("/session-clips", "POST", { streamerId: 999, sessionKey: "live:missing" }))
        .status,
    ).toBe(404);
    expect((await request("/session-clips", "POST", {})).status).toBe(400);
    expect(dependencies.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(
      legacySchema,
    );
  });

  it("a new clip makes a previously completed session incomplete without resetting old clips", async () => {
    dependencies.db.exec(`INSERT INTO record_history
      (id, streamer_id, record_start_time, live_id, title, video_file)
      VALUES (4, 1, 4000, 'same-stream', '新增分段', '/new.mp4')`);
    const result = await (await request("/sessions?status=watching")).json();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      streamerId: 1,
      clipCount: 3,
      watch: { completed: false, completedCount: 2, totalCount: 3, status: "watching" },
    });
    const clips = await (
      await request("/session-clips", "POST", {
        streamerId: 1,
        sessionKey: "live:same-stream",
      })
    ).json();
    expect(clips.data.map((item: any) => item.watch?.completed || false)).toEqual([
      true,
      true,
      false,
    ]);
    expect((await (await request("/sessions?status=completed")).json()).data).toEqual([]);
  });

  it("checks file replacements on expansion without re-reading every video in collapsed lists", async () => {
    const record = dependencies.db.prepare("SELECT * FROM record_history WHERE id = 1").get();
    fs.writeFileSync(record.video_file, Buffer.alloc(70000, 8));
    const before = await (await request("/sessions?status=watching")).json();
    expect(before.data[0].watch.completedCount).toBe(2);
    const expanded = await (
      await request("/session-clips", "POST", {
        streamerId: 1,
        sessionKey: "live:same-stream",
      })
    ).json();
    expect(expanded.watch).toMatchObject({ completedCount: 0, totalCount: 3, status: "unwatched" });
    expect(expanded.data[0].watch.position).toBe(0);
    expect((await (await request("/sessions?status=unwatched")).json()).data).toHaveLength(2);
  });
});
