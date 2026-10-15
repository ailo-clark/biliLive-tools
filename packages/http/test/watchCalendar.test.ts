import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createRequire } from "node:module";
import Koa from "koa";
import { bodyParser } from "@koa/bodyparser";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
const Database = createRequire(new URL("../../shared/package.json", import.meta.url))(
  "better-sqlite3",
);
const fixture = vi.hoisted(() => ({
  db: null as any,
  store: null as any,
  recorders: [] as any[],
  providers: [] as any[],
}));
vi.mock("@biliLive-tools/shared/db/index.js", () => ({
  getMainDb: () => fixture.db,
  get watchHistoryStore() {
    return fixture.store;
  },
  recordHistoryService: {
    query: ({ id }: any) => fixture.db.prepare("SELECT * FROM record_history WHERE id = ?").get(id),
  },
}));
vi.mock("../src/index.js", () => ({
  container: {
    resolve: () => ({ manager: { recorders: fixture.recorders, providers: fixture.providers } }),
  },
  appConfig: {
    get: () => [
      {
        channelId: "10",
        providerId: "Bilibili",
        extra: { avatar: "https://example.com/avatar.png" },
      },
    ],
  },
  fileCache: { get: () => undefined, setFile: () => "token" },
}));
import { WatchHistoryStore, recordWatchKey } from "../../shared/src/db/watchHistory.js";
import router from "../src/routes/watchHistory.js";

describe("streamer calendar against independent watch data", () => {
  let directory: string;
  let server: Server;
  let base: string;
  let originalRecords: any;
  let originalSchema: any;
  const get = (url: string, auth = true) =>
    fetch(`${base}${url}`, { headers: auth ? { Authorization: "test" } : {} });
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "watch-calendar-"));
    fixture.db = new Database(path.join(directory, "app.db"));
    fixture.db
      .exec(`CREATE TABLE streamer (id INTEGER PRIMARY KEY, name TEXT, platform TEXT, room_id TEXT);
      INSERT INTO streamer VALUES (10, '主播甲', 'Bilibili', '10'), (20, '归档主播', 'Bilibili', '20');
      CREATE TABLE record_history (id INTEGER PRIMARY KEY, streamer_id INTEGER, live_id TEXT,
        live_start_time INTEGER, record_start_time INTEGER, record_end_time INTEGER, title TEXT, video_file TEXT, video_duration REAL);`);
    const insert = fixture.db.prepare(
      "INSERT INTO record_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const start = Date.parse("2026-10-12T15:50:00Z");
    insert.run(
      1,
      10,
      "cross",
      start / 1000,
      start + 300000,
      start + 1500000,
      "午夜直播",
      "/one.mp4",
      1200,
    );
    insert.run(
      2,
      10,
      "cross",
      start,
      start + 1800000,
      start + 3000000,
      "午夜直播",
      "/two.mp4",
      1200,
    );
    const later = Date.parse("2026-10-12T17:00:00Z");
    insert.run(3, 10, "second", later, later, later + 600000, "凌晨直播", "/three.mp4", 600);
    const november = Date.parse("2026-11-01T04:00:00Z");
    insert.run(4, 10, "third", november, november, november + 600000, "新月份", "/four.mp4", 600);
    insert.run(5, 20, null, later, later, later + 600000, "归档录像", "/five.mp4", 600);
    insert.run(
      6,
      20,
      null,
      later / 1000,
      later + 600000,
      later + 1200000,
      "归档录像",
      "/six.mp4",
      600,
    );
    originalRecords = fixture.db.prepare("SELECT * FROM record_history ORDER BY id").all();
    originalSchema = fixture.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
    fixture.store = new WatchHistoryStore(directory);
    fixture.store.initializeExistingRecords([]); // New records, not legacy defaults.
    for (const record of originalRecords)
      fixture.store.ensure({
        key: recordWatchKey(record),
        recordId: record.id,
        filePath: record.video_file,
        title: record.title,
      });
    fixture.store.update(recordWatchKey(originalRecords[0]), { revision: 0, action: "completed" });
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fixture.store.close();
    fixture.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("requires authentication and guards malformed IDs, months and time zones", async () => {
    expect((await get("/streamers", false)).status).toBe(401);
    for (const query of [
      "/calendar/-1",
      "/calendar/10?month=2026-13",
      "/calendar/10?month=oops",
      "/calendar/10?timeZone=Not/AZone",
      "/streamers?limit=10000",
      "/sessions?streamerId=-1",
    ])
      expect((await get(query)).status).toBe(400);
    expect((await get("/calendar/999")).status).toBe(404);
  });
  it("keeps archived streamers visible and summarizes entire sessions", async () => {
    const result = await (await get("/streamers")).json();
    expect(result.total).toBe(2);
    expect(result.data[0]).toMatchObject({
      id: 10,
      avatar: "https://example.com/avatar.png",
      sessionCount: 3,
      watchingCount: 1,
      unwatchedCount: 2,
    });
    expect(result.data[1]).toMatchObject({ id: 20, avatar: null, sessionCount: 1 });
    const page = await (await get("/streamers?limit=1")).json();
    expect(page.nextOffset).toBe(1);
    expect((await (await get("/streamers?offset=1&limit=1")).json()).data[0].id).toBe(20);
    expect((await (await get("/streamers?search=午夜")).json()).data[0].sessionCount).toBe(3);
  });
  it("opens the newest available month by default and supports empty months", async () => {
    const result = await (await get("/calendar/10?timeZone=Asia/Shanghai")).json();
    expect(result.month).toBe("2026-11");
    expect(result.availableMonths).toEqual(["2026-11", "2026-10"]);
    expect(result.days[0]).toMatchObject({
      date: "2026-11-01",
      sessionCount: 1,
      status: "unwatched",
    });
    expect((await (await get("/calendar/10?month=2026-09")).json()).days).toEqual([]);
  });
  it("normalizes original timestamp units and assigns cross-midnight sessions to their start date", async () => {
    const result = await (await get("/calendar/10?month=2026-10&timeZone=Asia/Shanghai")).json();
    expect(result.sessions).toHaveLength(2);
    const cross = result.sessions.find((session: any) => session.sessionKey === "live:cross");
    expect(cross).toMatchObject({
      date: "2026-10-12",
      crossesMidnight: true,
      clipCount: 2,
      startTime: Date.parse("2026-10-12T15:50:00Z"),
    });
    expect(result.days.find((day: any) => day.date === "2026-10-12")).toMatchObject({
      sessionCount: 1,
      completedClips: 1,
      totalClips: 2,
      status: "watching",
    });
    expect(result.days.find((day: any) => day.date === "2026-10-13").sessionCount).toBe(1);
    const utc = await (await get("/calendar/10?month=2026-10&timeZone=UTC")).json();
    expect(utc.days).toHaveLength(1);
    expect(utc.days[0].sessionCount).toBe(2);
  });
  it("updates daily status from segment marks and returns session metadata with episodes", async () => {
    fixture.store.update(recordWatchKey(originalRecords[1]), { revision: 0, action: "completed" });
    const result = await (await get("/calendar/10?month=2026-10&timeZone=Asia/Shanghai")).json();
    expect(result.days.find((day: any) => day.date === "2026-10-12").status).toBe("completed");
    const response = await fetch(`${base}/session-clips`, {
      method: "POST",
      headers: { Authorization: "test", "Content-Type": "application/json" },
      body: JSON.stringify({ streamerId: 10, sessionKey: "live:cross" }),
    });
    const session = await response.json();
    expect(session.session.streamerId).toBe(10);
    expect(session.data.map((clip: any) => clip.id)).toEqual([1, 2]);
    expect(session.watch.completed).toBe(true);
  });
  it("filters a streamer's chronological library without leaking other streamers", async () => {
    const result = await (await get("/sessions?streamerId=20")).json();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].streamerId).toBe(20);
    expect(result.data[0].clipCount).toBe(2);
    expect(fixture.db.prepare("SELECT * FROM record_history ORDER BY id").all()).toEqual(
      originalRecords,
    );
    expect(fixture.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(
      originalSchema,
    );
  });

  it("accepts old second-based session links and groups mixed units without a live ID", async () => {
    const later = Date.parse("2026-10-12T17:00:00Z");
    const response = await fetch(`${base}/session-clips`, {
      method: "POST",
      headers: { Authorization: "test", "Content-Type": "application/json" },
      body: JSON.stringify({ streamerId: 20, sessionKey: `start:${later / 1000}` }),
    });
    const result = await response.json();
    expect(result.data.map((clip: any) => clip.id)).toEqual([5, 6]);
    expect(result.session.sessionKey).toBe(`start:${later}`);
    expect(result.session.clipCount).toBe(2);
  });

  it("hides archived streamers across lists, persists through restart and restores without changing history", async () => {
    const change = (id: number, body: unknown, auth = true) =>
      fetch(`${base}/streamers/${id}/visibility`, {
        method: "PUT",
        headers: { ...(auth ? { Authorization: "test" } : {}), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await change(20, { hidden: true }, false)).status).toBe(401);
    expect((await change(-1, { hidden: true })).status).toBe(400);
    expect((await change(20, { hidden: "true" })).status).toBe(400);
    expect((await change(999, { hidden: true })).status).toBe(404);
    expect((await get("/streamers?includeHidden=invalid")).status).toBe(400);
    const key = recordWatchKey(originalRecords[4]);
    fixture.store.update(key, { revision: 0, action: "progress", position: 45, duration: 600 });
    const saved = fixture.store.get(key);
    expect(
      (await (await get("/sessions?recent=true")).json()).data.map((s: any) => s.streamerId),
    ).toContain(20);
    expect((await change(20, { hidden: true })).status).toBe(200);
    expect((await change(20, { hidden: true })).status).toBe(200);
    const visible = await (await get("/streamers?limit=1")).json();
    expect(visible).toMatchObject({ total: 1, nextOffset: null });
    expect(visible.data.map((s: any) => s.id)).toEqual([10]);
    expect((await (await get("/streamers?search=归档")).json()).total).toBe(0);
    const including = await (await get("/streamers?includeHidden=true&offset=1&limit=1")).json();
    expect(including.total).toBe(2);
    expect(including.data[0]).toMatchObject({ id: 20, hidden: true });
    for (const url of [
      "/sessions",
      "/sessions?recent=true",
      "/library",
      "/sessions?limit=1&before=4",
    ])
      expect(
        (await (await get(url)).json()).data.every(
          (s: any) => (s.streamerId ?? s.streamer_id) !== 20,
        ),
      ).toBe(true);
    expect((await (await get("/recent")).json()).every((s: any) => s.recordId !== 5)).toBe(true);
    // Visibility is a library preference: explicit calendar/session links remain playable.
    expect((await get("/calendar/20")).status).toBe(200);
    expect((await (await get("/sessions?streamerId=20")).json()).data).toHaveLength(1);
    fixture.store.close();
    fixture.store = new WatchHistoryStore(directory);
    expect((await (await get("/streamers")).json()).total).toBe(1);
    expect(fixture.store.get(key)).toEqual(saved);
    expect((await change(20, { hidden: false })).status).toBe(200);
    expect((await (await get("/streamers")).json()).total).toBe(2);
    expect((await (await get("/recent")).json()).some((s: any) => s.recordId === 5)).toBe(true);
    expect(fixture.store.get(key)).toEqual(saved);
    expect(fixture.db.prepare("SELECT * FROM record_history ORDER BY id").all()).toEqual(
      originalRecords,
    );
    expect(fixture.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(
      originalSchema,
    );
  });

  it("fetches room avatars like the recorder page, caches concurrent requests and keeps archived/history data intact", async () => {
    expect((await get("/streamers/10/avatar", false)).status).toBe(401);
    expect((await get("/streamers/-1/avatar")).status).toBe(400);
    expect((await get("/streamers/999/avatar")).status).toBe(404);
    let complete!: (value: any) => void;
    const lookup = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    fixture.recorders.push({
      providerId: "Bilibili",
      channelId: "10",
      liveInfo: { avatar: "https://example.com/runtime.png" },
      getLiveInfo: lookup,
    });
    expect((await (await get("/streamers")).json()).data[0].avatar).toBe(
      "https://example.com/runtime.png",
    );
    const pending = Promise.all([get("/streamers/10/avatar"), get("/streamers/10/avatar")]);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    complete({ avatar: "https://example.com/fresh.png" });
    for (const response of await pending)
      expect(await response.json()).toEqual({ avatar: "https://example.com/fresh.png" });
    fixture.store.close();
    fixture.store = new WatchHistoryStore(directory);
    expect((await (await get("/streamers/10/avatar")).json()).avatar).toBe(
      "https://example.com/fresh.png",
    );
    expect(lookup).toHaveBeenCalledOnce();
    lookup.mockRejectedValueOnce(new Error("room unavailable"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 21 * 60_000);
    try {
      expect((await (await get("/streamers/10/avatar")).json()).avatar).toBe(
        "https://example.com/fresh.png",
      );
      await get("/streamers/10/avatar");
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
    const create = vi.fn(() => ({
      getLiveInfo: async () => ({ avatar: "https://example.com/archive.png" }),
    }));
    fixture.providers.push({ id: "Bilibili", createRecorder: create });
    expect((await (await get("/streamers/20/avatar")).json()).avatar).toBe(
      "https://example.com/archive.png",
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "20", disableAutoCheck: true }),
    );
    expect(fixture.recorders).toHaveLength(1);
    expect(fixture.db.prepare("SELECT * FROM record_history ORDER BY id").all()).toEqual(
      originalRecords,
    );
    expect(fixture.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(
      originalSchema,
    );
  });
});
