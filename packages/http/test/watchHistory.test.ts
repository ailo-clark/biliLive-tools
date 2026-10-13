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
      CREATE TABLE record_history (id INTEGER PRIMARY KEY, streamer_id INTEGER, record_start_time INTEGER, live_id TEXT, title TEXT, video_file TEXT);`);
    const insert = dependencies.db.prepare(
      "INSERT INTO record_history VALUES (?, 1, ?, NULL, ?, ?)",
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

  it("reads old recordings as unwatched without a schema migration", async () => {
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
});
