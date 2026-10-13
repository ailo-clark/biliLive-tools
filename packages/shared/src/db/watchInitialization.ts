import path from "node:path";
import fs from "node:fs/promises";
import { fileWatchKey, recordWatchKey, type WatchHistoryStore } from "./watchHistory.js";
import type { LiveHistory } from "./model/recordHistory.js";
import type Database from "better-sqlite3";

const videoExtensions = new Set([".flv", ".mp4", ".ts", ".mkv", ".webm", ".m4v", ".m4s"]);

/** Scan metadata and a bounded fingerprint once, before starting any recorder. */
export async function initializeExistingVideoFiles(
  store: WatchHistoryStore,
  db: Database.Database,
  directories: string[],
) {
  if (store.metadata("existing-files-initialized")) return;
  const cutoff = Number(store.metadata("existing-records-initialized"));
  if (!cutoff) throw new Error("观看记录尚未初始化");
  const lookup = db.prepare(
    "SELECT * FROM record_history WHERE video_file = ? ORDER BY id DESC LIMIT 1",
  );
  const visited = new Set<string>();
  async function scan(directory: string) {
    const real = await fs.realpath(directory).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!real || visited.has(real)) return;
    visited.add(real);
    for (const entry of await fs.readdir(real, { withFileTypes: true })) {
      const filePath = path.join(real, entry.name);
      if (entry.isDirectory()) {
        await scan(filePath);
        continue;
      }
      if (!entry.isFile() || !videoExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(filePath);
      // If an interrupted scan is retried, newly created files must stay unwatched.
      if ((stat.birthtimeMs || stat.mtimeMs) > cutoff) continue;
      const fingerprint = await fileWatchKey(filePath);
      const candidates = [filePath];
      if (path.extname(filePath).toLowerCase() === ".mp4") {
        const stem = path.join(path.dirname(filePath), path.parse(filePath).name);
        candidates.push(`${stem}.flv`, `${stem}.ts`);
      }
      const record = candidates
        .map((candidate) => lookup.get(candidate) as LiveHistory | undefined)
        .find(Boolean);
      if (record) {
        // A record created after the initial snapshot isn't a legacy video.
        if (store.get(recordWatchKey(record)))
          store.ensure(
            {
              key: recordWatchKey(record),
              recordId: record.id,
              filePath,
              title: record.title || entry.name,
            },
            fingerprint,
          );
      } else {
        store.initializeExistingTarget({ key: fingerprint, filePath, title: entry.name });
      }
    }
  }
  for (const directory of new Set(directories.filter(Boolean))) await scan(directory);
  store.setMetadata("existing-files-initialized", "true");
}
