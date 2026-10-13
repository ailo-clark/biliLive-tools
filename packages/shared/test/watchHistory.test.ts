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
import { recordSessionKey, summarizeSessionWatch } from "../src/db/recordSession.js";
import { initializeExistingVideoFiles } from "../src/db/watchInitialization.js";
import { initDB, closeDB, getMainDb } from "../src/db/index.js";

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

  it("keeps legacy databases byte-for-byte unchanged and defaults new videos to unwatched", () => {
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

  it("initializes old recordings once while preserving progress and explicit unwatched marks", () => {
    const records = [1, 2, 3, 4].map((id) => ({
      id,
      streamer_id: 1,
      record_start_time: id * 1000,
      video_file: `/videos/${id}.mp4`,
      title: `录像 ${id}`,
    }));
    const targets = records.map((record) => ({
      key: recordWatchKey(record),
      filePath: record.video_file,
      title: record.title,
      recordId: record.id,
    }));
    store.ensure(targets[0]); // v1 resolved/listed, never actually watched
    store.ensure(targets[1]);
    store.update(targets[1].key, { revision: 0, action: "progress", position: 37, duration: 120 });
    store.ensure(targets[2]);
    store.update(targets[2].key, { revision: 0, action: "unwatched" });
    store.initializeExistingRecords(records);
    expect(store.get(targets[0].key)).toMatchObject({
      completed: true,
      revision: 0,
      lastPlayedAt: 0,
    });
    expect(store.get(targets[1].key)).toMatchObject({
      completed: false,
      position: 37,
      revision: 1,
    });
    expect(store.get(targets[2].key)).toMatchObject({ completed: false, revision: 1 });
    expect(store.get(targets[3].key)?.completed).toBe(true);
    store.update(targets[0].key, { revision: 0, action: "unwatched" });
    const newRecord = { ...records[0], id: 5, record_start_time: 5000 };
    store.close();
    store = new WatchHistoryStore(directory);
    store.initializeExistingRecords([...records, newRecord]);
    expect(store.get(targets[0].key)?.completed).toBe(false);
    expect(store.ensure({ ...targets[0], key: recordWatchKey(newRecord) }).completed).toBe(false);
    expect(store.recent().map((item) => item.key)).toEqual([targets[1].key]);
  });

  it("snapshots standalone files once and leaves new/replaced files unwatched", async () => {
    const root = path.join(directory, "videos");
    fs.mkdirSync(root);
    const oldFile = path.join(root, "old.mp4");
    fs.writeFileSync(oldFile, Buffer.alloc(70000, 1));
    const oldKey = await fileWatchKey(oldFile);
    const db = new Database(path.join(directory, "app.db"));
    db.exec("CREATE TABLE record_history (id INTEGER, video_file TEXT)");
    const before = fs.readFileSync(path.join(directory, "app.db"));
    store.initializeExistingRecords([]);
    store.setMetadata("existing-records-initialized", String(fs.statSync(oldFile).birthtimeMs + 1));
    await initializeExistingVideoFiles(store, db, [root, root]);
    expect(store.get(oldKey)?.completed).toBe(true);
    store.update(oldKey, { revision: 0, action: "unwatched" });
    const newFile = path.join(root, "new.mp4");
    fs.writeFileSync(newFile, Buffer.alloc(70000, 2));
    await initializeExistingVideoFiles(store, db, [root]);
    expect(store.get(oldKey)?.completed).toBe(false);
    expect(store.get(await fileWatchKey(newFile))).toBeNull();
    fs.writeFileSync(oldFile, Buffer.alloc(70000, 3));
    expect(
      store.ensure({ key: await fileWatchKey(oldFile), filePath: oldFile, title: "替换文件" })
        .completed,
    ).toBe(false);
    db.close();
    expect(fs.readFileSync(path.join(directory, "app.db"))).toEqual(before);
  });

  it("retries an interrupted file scan against its original cutoff", async () => {
    const root = path.join(directory, "retry");
    fs.mkdirSync(root);
    const oldFile = path.join(root, "old.mp4");
    fs.writeFileSync(oldFile, Buffer.alloc(70000, 1));
    const db = new Database(path.join(directory, "app.db"));
    db.exec("CREATE TABLE record_history (id INTEGER, video_file TEXT)");
    store.initializeExistingRecords([]);
    store.setMetadata("existing-records-initialized", String(fs.statSync(oldFile).birthtimeMs));
    const newFile = path.join(root, "new.mp4");
    await new Promise((resolve) => setTimeout(resolve, 5));
    fs.writeFileSync(newFile, Buffer.alloc(70000, 2));
    await initializeExistingVideoFiles(store, db, [root]);
    expect(store.get(await fileWatchKey(oldFile))?.completed).toBe(true);
    expect(store.get(await fileWatchKey(newFile))).toBeNull();
    db.close();
  });

  it("backs up the initialization marker so restoring never marks newer recordings watched", async () => {
    store.initializeExistingRecords([]);
    const backup = path.join(directory, "initialized.db");
    await store.backup(backup);
    store.close();
    fs.copyFileSync(backup, path.join(directory, "watch-history.db"));
    store = new WatchHistoryStore(directory);
    const record = { id: 1, streamer_id: 1, record_start_time: 1000, video_file: "/new.mp4" };
    store.initializeExistingRecords([record]);
    expect(store.get(recordWatchKey(record))).toBeNull();
  });

  it("leaves the main connection writable after restarting an initialized installation", () => {
    const data = path.join(directory, "restart");
    fs.mkdirSync(data);
    initDB(data);
    getMainDb().exec("CREATE TABLE restart_check (id INTEGER)");
    closeDB();
    initDB(data);
    try {
      expect(() => getMainDb().exec("INSERT INTO restart_check VALUES (1)")).not.toThrow();
      expect(getMainDb().prepare("SELECT id FROM restart_check").get()).toEqual({ id: 1 });
    } finally {
      closeDB();
    }
  });

  it("derives whole-session status from every clip, including partially completed sessions", () => {
    const unwatched = store.get(target.key)!;
    const watched = { ...unwatched, completed: true };
    expect(summarizeSessionWatch([null, unwatched]).status).toBe("unwatched");
    expect(summarizeSessionWatch([watched, unwatched])).toMatchObject({
      status: "watching",
      completedCount: 1,
      totalCount: 2,
      completed: false,
    });
    expect(summarizeSessionWatch([watched, watched]).status).toBe("completed");
    expect(summarizeSessionWatch([]).completed).toBe(false);
  });

  it("separates unidentified sessions and keeps segments with one stream start together", () => {
    expect(recordSessionKey({ id: 1, live_id: "abc", live_start_time: 1000 })).toBe("live:abc");
    expect(recordSessionKey({ id: 1, live_start_time: 1000 })).toBe(
      recordSessionKey({ id: 2, live_start_time: 1000 }),
    );
    expect(recordSessionKey({ id: 1, live_start_time: 1000 })).not.toBe(
      recordSessionKey({ id: 2, live_start_time: 2000 }),
    );
    expect(recordSessionKey({ id: 1 })).not.toBe(recordSessionKey({ id: 2 }));
  });
});
