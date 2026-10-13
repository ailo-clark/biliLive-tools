import path from "node:path";
import fs from "fs-extra";
import { getMainDb, watchHistoryStore } from "@biliLive-tools/shared/db/index.js";
import { fileWatchKey, recordWatchKey } from "@biliLive-tools/shared/db/watchHistory.js";
import { sessionKeySQL, summarizeSessionWatch } from "@biliLive-tools/shared/db/recordSession.js";
import type { LiveHistory } from "@biliLive-tools/shared/db/model/recordHistory.js";

export function sessionRecords(streamerId: number, sessionKey: string) {
  return getMainDb()
    .prepare(
      `SELECT r.* FROM record_history r WHERE r.streamer_id = ?
    AND ${sessionKeySQL} = ? AND coalesce(r.video_file, '') != ''
    ORDER BY r.record_start_time ASC, r.id ASC`,
    )
    .all(streamerId, sessionKey) as LiveHistory[];
}

export async function sessionWatch(records: LiveHistory[]) {
  return summarizeSessionWatch(await Promise.all(records.map(recordWatchState)));
}

export async function recordWatchState(record: LiveHistory) {
  const state = watchHistoryStore.get(recordWatchKey(record));
  return state ? resolveRecordWatch(record) : null;
}

export async function resolveRecordWatch(record: LiveHistory) {
  let filePath = record.video_file || "";
  if (filePath && !(await fs.pathExists(filePath))) {
    const mp4 = path.join(path.dirname(filePath), `${path.parse(filePath).name}.mp4`);
    if (await fs.pathExists(mp4)) filePath = mp4;
  }
  const fingerprint =
    filePath && (await fs.pathExists(filePath))
      ? await fileWatchKey(filePath).catch(() => undefined)
      : undefined;
  return watchHistoryStore.ensure(
    {
      key: recordWatchKey(record),
      filePath,
      title: record.title || path.basename(filePath),
      recordId: record.id,
    },
    fingerprint,
  );
}

function fileRecord(filePath: string) {
  const candidates = [filePath];
  if (path.extname(filePath).toLowerCase() === ".mp4") {
    const stem = path.join(path.dirname(filePath), path.parse(filePath).name);
    candidates.push(`${stem}.flv`, `${stem}.ts`);
  }
  for (const candidate of candidates) {
    const record = getMainDb()
      .prepare("SELECT * FROM record_history WHERE video_file = ? ORDER BY id DESC LIMIT 1")
      .get(candidate) as LiveHistory | undefined;
    if (record) return record;
  }
  return null;
}

export async function fileWatchState(filePath: string) {
  const record = fileRecord(filePath);
  return record ? recordWatchState(record) : watchHistoryStore.get(await fileWatchKey(filePath));
}

export async function resolveFileWatch(filePath: string) {
  const record = fileRecord(filePath);
  if (record) return resolveRecordWatch(record);
  return watchHistoryStore.ensure({
    key: await fileWatchKey(filePath),
    filePath,
    title: path.basename(filePath),
  });
}
