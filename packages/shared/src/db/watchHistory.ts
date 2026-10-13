import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

export interface WatchTarget {
  key: string;
  filePath: string;
  title: string;
  recordId?: number | null;
}

export interface WatchState extends WatchTarget {
  position: number;
  duration: number;
  completed: boolean;
  revision: number;
  updatedAt: number;
  lastPlayedAt: number;
}

export interface WatchUpdate {
  revision: number;
  action: "progress" | "completed" | "unwatched" | "restart";
  position?: number;
  duration?: number;
}

export function recordWatchKey(record: {
  id: number;
  streamer_id: number;
  record_start_time: number;
  live_id?: string | null;
}) {
  // Never use the expiring playback URL, or mutable title/duration/file extension.
  const identity = JSON.stringify([
    record.id,
    record.streamer_id,
    record.record_start_time,
    record.live_id ?? "",
  ]);
  return `record:${createHash("sha256").update(identity).digest("hex")}`;
}

export async function fileWatchKey(filePath: string) {
  const realPath = await fs.realpath(filePath);
  const file = await fs.open(realPath, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("不是视频文件");
    // A bounded fingerprint distinguishes replacements without hashing hours of video.
    // Do not use size/mtime: an actively recorded file may grow between saves.
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const normalized = process.platform === "win32" ? realPath.toLowerCase() : realPath;
    return `file:${createHash("sha256")
      .update(normalized)
      .update(String(stat.birthtimeMs))
      .update(buffer.subarray(0, bytesRead))
      .digest("hex")}`;
  } finally {
    await file.close();
  }
}

/** Owns only watch-history.db; never opens or migrates app.db or dm0.db. */
export class WatchHistoryStore {
  private db: Database.Database;

  constructor(directory: string) {
    this.db = new Database(path.join(directory, "watch-history.db"));
    this.db.pragma("journal_mode = WAL");
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 1) {
      this.db.close();
      throw new Error("观看数据库版本较新，请使用对应版本的软件");
    }
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS watch_history (
          key TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          title TEXT NOT NULL,
          record_id INTEGER,
          position REAL NOT NULL DEFAULT 0,
          duration REAL NOT NULL DEFAULT 0,
          completed INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0,
          last_played_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS watch_history_recent ON watch_history(last_played_at DESC);
        CREATE TABLE IF NOT EXISTS watch_identity (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS watch_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 1;
      `);
    })();
  }

  private read(row: any): WatchState | null {
    if (!row) return null;
    return {
      key: row.key,
      filePath: row.file_path,
      title: row.title,
      recordId: row.record_id,
      position: row.position,
      duration: row.duration,
      completed: Boolean(row.completed),
      revision: row.revision,
      updatedAt: row.updated_at,
      lastPlayedAt: row.last_played_at,
    };
  }

  get(key: string) {
    return this.read(this.db.prepare("SELECT * FROM watch_history WHERE key = ?").get(key));
  }

  metadata(key: string) {
    return (
      this.db.prepare("SELECT value FROM watch_metadata WHERE key = ?").get(key) as
        | { value: string }
        | undefined
    )?.value;
  }

  setMetadata(key: string, value: string) {
    this.db.prepare("INSERT OR REPLACE INTO watch_metadata VALUES (?, ?)").run(key, value);
  }

  /** Snapshot once. Explicit marks/progress from the previous release always win. */
  initializeExistingRecords(
    records: Iterable<
      Parameters<typeof recordWatchKey>[0] & {
        video_file?: string | null;
        title?: string | null;
      }
    >,
  ) {
    if (this.metadata("existing-records-initialized")) return;
    this.db.transaction(() => {
      for (const record of records) {
        if (!record.video_file) continue;
        this.initializeExistingTarget({
          key: recordWatchKey(record),
          filePath: record.video_file,
          title: record.title || path.basename(record.video_file),
          recordId: record.id,
        });
      }
      this.setMetadata("existing-records-initialized", String(Date.now()));
    })();
  }

  initializeExistingTarget(target: WatchTarget, fingerprint?: string) {
    const state = this.ensure(target, fingerprint);
    // Merely listing/resolving a video in v1 created a revision-zero row.
    if (state.revision === 0 && !state.updatedAt && !state.lastPlayedAt && !state.position) {
      this.db.prepare("UPDATE watch_history SET completed = 1 WHERE key = ?").run(target.key);
    }
  }

  playedRecords() {
    return this.db
      .prepare(
        `SELECT key, record_id AS recordId, last_played_at AS lastPlayedAt
      FROM watch_history WHERE record_id IS NOT NULL AND last_played_at > 0
      ORDER BY last_played_at DESC`,
      )
      .all() as Array<{ key: string; recordId: number; lastPlayedAt: number }>;
  }

  ensure(target: WatchTarget, fingerprint?: string): WatchState {
    return this.db.transaction(() => {
      if (fingerprint) {
        const previous = this.db
          .prepare("SELECT fingerprint FROM watch_identity WHERE key = ?")
          .get(target.key) as { fingerprint: string } | undefined;
        const current = this.get(target.key);
        // A remux/relocation of the same recording may change its path. A replacement
        // at the same path must not inherit its progress, even if record_id is reused.
        if (
          previous &&
          previous.fingerprint !== fingerprint &&
          current?.filePath === target.filePath
        ) {
          this.db
            .prepare(
              `UPDATE watch_history SET position = 0, duration = 0, completed = 0,
            last_played_at = 0, revision = revision + 1 WHERE key = ?`,
            )
            .run(target.key);
        }
        this.db
          .prepare(
            "INSERT INTO watch_identity VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET fingerprint = excluded.fingerprint",
          )
          .run(target.key, fingerprint);
      }
      this.db
        .prepare(
          `
      INSERT INTO watch_history (key, file_path, title, record_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET file_path = excluded.file_path,
        title = excluded.title, record_id = excluded.record_id
      `,
        )
        .run(target.key, target.filePath, target.title, target.recordId ?? null);
      return this.get(target.key)!;
    })();
  }

  update(key: string, update: WatchUpdate): { conflict: boolean; state: WatchState | null } {
    if (
      !Number.isSafeInteger(update.revision) ||
      update.revision < 0 ||
      [update.position, update.duration].some(
        (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
      )
    ) {
      throw new Error("无效的播放进度");
    }
    return this.db.transaction(() => {
      const current = this.get(key);
      if (!current || current.revision !== update.revision)
        return { conflict: true, state: current };
      const duration = update.duration ?? current.duration;
      let position = update.position ?? current.position;
      if (duration > 0) position = Math.min(position, duration);
      let completed = current.completed;
      if (update.action === "completed") completed = true;
      if (update.action === "unwatched" || update.action === "restart") {
        completed = false;
        position = 0;
      }
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE watch_history SET position = ?, duration = ?, completed = ?,
        revision = revision + 1, updated_at = ?, last_played_at = ? WHERE key = ?`,
        )
        .run(
          position,
          duration,
          Number(completed),
          now,
          update.action === "unwatched"
            ? 0
            : update.action === "progress" || update.action === "restart"
              ? now
              : current.lastPlayedAt,
          key,
        );
      return { conflict: false, state: this.get(key) };
    })();
  }

  recent(limit = 30, offset = 0, status: "all" | "watching" | "completed" = "all") {
    const filter =
      status === "all" ? "" : status === "completed" ? " AND completed = 1" : " AND completed = 0";
    return this.db
      .prepare(
        `SELECT * FROM watch_history WHERE last_played_at > 0${filter}
      ORDER BY last_played_at DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset)
      .map((row) => this.read(row)!);
  }

  backup(filename: string) {
    return this.db.backup(filename);
  }

  close() {
    this.db.close();
  }
}

export function validateWatchBackup(filename: string) {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (
      db.pragma("user_version", { simple: true }) !== 1 ||
      db.pragma("integrity_check", { simple: true }) !== "ok"
    ) {
      throw new Error("观看历史备份版本不支持或文件损坏");
    }
    const columns = db.prepare("PRAGMA table_info(watch_history)").all() as Array<{ name: string }>;
    for (const name of [
      "key",
      "file_path",
      "title",
      "record_id",
      "position",
      "duration",
      "completed",
      "revision",
      "updated_at",
      "last_played_at",
    ]) {
      if (!columns.some((column) => column.name === name))
        throw new Error("观看历史备份结构不完整");
    }
  } finally {
    db.close();
  }
}
