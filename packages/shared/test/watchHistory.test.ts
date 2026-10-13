import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WatchHistoryStore,
  fileWatchKey,
  recordWatchKey,
  validateWatchBackup,
} from "../src/db/watchHistory.js";

describe("independent watch history", () => {
  let directory: string;
  let store: WatchHistoryStore;
  const target = { key: "file:sample", filePath: "/videos/sample.mp4", title: "录像" };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "watch-history-"));
    store = new WatchHistoryStore(directory);
    store.ensure(target);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("keeps legacy databases byte-for-byte unchanged and defaults old videos to unwatched", () => {
    for (const name of ["app.db", "dm0.db"]) {
      const db = new Database(path.join(directory, name));
      db.exec(
        "CREATE TABLE legacy (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO legacy VALUES (1, '旧录制记录')",
      );
      db.close();
    }
    const originals = ["app.db", "dm0.db"].map((name) =>
      fs.readFileSync(path.join(directory, name)),
    );
    store.close();
    store = new WatchHistoryStore(directory);
    store.update(target.key, { revision: 0, action: "progress", position: 125, duration: 900 });
    ["app.db", "dm0.db"].forEach((name, index) =>
      expect(fs.readFileSync(path.join(directory, name))).toEqual(originals[index]),
    );
    expect(store.ensure({ ...target, key: "file:old-video" })).toMatchObject({
      position: 0,
      completed: false,
    });
  });

  it("persists progress after a restart and metadata refresh", () => {
    store.update(target.key, { revision: 0, action: "progress", position: 321.5, duration: 2000 });
    store.close();
    store = new WatchHistoryStore(directory);
    expect(store.ensure({ ...target, title: "新标题" })).toMatchObject({
      position: 321.5,
      duration: 2000,
      revision: 1,
    });
  });

  it("rejects delayed saves and updates from a second tab", () => {
    store.update(target.key, { revision: 0, action: "progress", position: 200 });
    const stale = store.update(target.key, { revision: 0, action: "progress", position: 10 });
    expect(stale).toMatchObject({ conflict: true, state: { position: 200, revision: 1 } });
  });

  it("completion stays marked until an explicit reset, including delayed progress", () => {
    store.update(target.key, { revision: 0, action: "completed" });
    store.update(target.key, { revision: 1, action: "progress", position: 500, duration: 900 });
    expect(store.get(target.key)?.completed).toBe(true);
    store.update(target.key, { revision: 2, action: "unwatched" });
    expect(store.get(target.key)).toMatchObject({ position: 0, completed: false });
    expect(
      store.update(target.key, { revision: 2, action: "progress", position: 500 }).conflict,
    ).toBe(true);
  });

  it("does not infer completion from seeking and allows rewinding", () => {
    store.update(target.key, { revision: 0, action: "progress", position: 999, duration: 1000 });
    expect(store.get(target.key)?.completed).toBe(false);
    store.update(target.key, { revision: 1, action: "progress", position: 15, duration: 1000 });
    expect(store.get(target.key)?.position).toBe(15);
  });

  it("clamps positions and rejects invalid numbers without losing data", () => {
    store.update(target.key, { revision: 0, action: "progress", position: 101, duration: 100 });
    expect(store.get(target.key)?.position).toBe(100);
    for (const position of [-1, Infinity, NaN]) {
      expect(() =>
        store.update(target.key, { revision: 1, action: "progress", position }),
      ).toThrow();
    }
    expect(store.get(target.key)?.revision).toBe(1);
  });

  it("backs up the committed WAL data and restores it independently", async () => {
    store.update(target.key, { revision: 0, action: "progress", position: 345, duration: 999 });
    const backup = path.join(directory, "backup.db");
    await store.backup(backup);
    validateWatchBackup(backup);
    store.update(target.key, { revision: 1, action: "unwatched" });
    store.close();
    fs.copyFileSync(backup, path.join(directory, "watch-history.db"));
    store = new WatchHistoryStore(directory);
    expect(store.get(target.key)).toMatchObject({ position: 345, revision: 1 });
  });

  it("rejects invalid or newer backups without modifying them", () => {
    const legacy = path.join(directory, "legacy.db");
    const db = new Database(legacy);
    db.exec("CREATE TABLE other (id INTEGER); PRAGMA user_version = 2");
    db.close();
    const before = fs.readFileSync(legacy);
    expect(() => validateWatchBackup(legacy)).toThrow();
    expect(fs.readFileSync(legacy)).toEqual(before);
    expect(store.get(target.key)?.position).toBe(0);
  });

  it("lists recent watched videos but not merely opened videos", () => {
    store.ensure({ ...target, key: "file:other" });
    expect(store.recent()).toEqual([]);
    store.update(target.key, { revision: 0, action: "progress", position: 20 });
    expect(store.recent(10, 0, "watching")).toHaveLength(1);
    store.update(target.key, { revision: 1, action: "completed" });
    expect(store.recent(10, 0, "watching")).toEqual([]);
    expect(store.recent(10, 0, "completed")).toHaveLength(1);
  });

  it("record identity survives title/duration changes but prevents reused IDs inheriting progress", () => {
    const record = { id: 1, streamer_id: 2, record_start_time: 1000 };
    expect(recordWatchKey({ ...record })).toBe(recordWatchKey(record));
    expect(recordWatchKey({ ...record, record_start_time: 2000 })).not.toBe(recordWatchKey(record));
  });

  it("file identity survives growth and changes when the same path is overwritten", async () => {
    const file = path.join(directory, "sample.mp4");
    fs.writeFileSync(file, Buffer.alloc(70000, 1));
    const key = await fileWatchKey(file);
    fs.appendFileSync(file, Buffer.alloc(1000, 1));
    expect(await fileWatchKey(file)).toBe(key);
    fs.writeFileSync(file, Buffer.alloc(71000, 2));
    expect(await fileWatchKey(file)).not.toBe(key);
  });
  it("resets replaced recording files and rejects saves made before the replacement", () => {
    store.ensure(target, "first-file");
    store.update(target.key, { revision: 0, action: "progress", position: 66 });
    expect(store.ensure(target, "replacement-file")).toMatchObject({
      position: 0,
      completed: false,
      revision: 2,
    });
    expect(
      store.update(target.key, { revision: 1, action: "progress", position: 66 }).conflict,
    ).toBe(true);
  });
  it("keeps progress for a relocated/remuxed recording", () => {
    store.ensure(target, "original-file");
    store.update(target.key, { revision: 0, action: "progress", position: 66 });
    expect(
      store.ensure({ ...target, filePath: "/moved/sample.mp4" }, "remuxed-file"),
    ).toMatchObject({ position: 66, revision: 1 });
  });
});
