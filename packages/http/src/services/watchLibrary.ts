import { getMainDb, watchHistoryStore } from "@biliLive-tools/shared/db/index.js";
import {
  recordSessionKey,
  liveStartMilliseconds,
} from "@biliLive-tools/shared/db/recordSession.js";
import { appConfig } from "../index.js";
import { sessionRecords, sessionWatch } from "./watchHistory.js";
import type { LiveHistory } from "@biliLive-tools/shared/db/model/recordHistory.js";
import type { Streamer } from "@biliLive-tools/shared/db/model/streamer.js";

export function libraryTimeZone(input?: string) {
  const timeZone = input || Intl.DateTimeFormat().resolvedOptions().timeZone;
  new Intl.DateTimeFormat("en", { timeZone }).format();
  return timeZone;
}

export function dateInZone(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function libraryStreamer(id: number) {
  const row = getMainDb().prepare("SELECT * FROM streamer WHERE id = ?").get(id) as
    | Streamer
    | undefined;
  if (!row) return null;
  const recorder = appConfig
    ?.get("recorders")
    ?.find(
      (item) =>
        item.channelId === row.room_id &&
        item.providerId.toLowerCase() === row.platform.toLowerCase(),
    );
  return {
    id: row.id,
    name: row.name,
    roomId: row.room_id,
    platform: row.platform,
    avatar: recorder?.extra?.avatar || null,
  };
}

export function describeSession(
  streamer: NonNullable<ReturnType<typeof libraryStreamer>>,
  records: LiveHistory[],
  timeZone = libraryTimeZone(),
) {
  const sorted = [...records].sort(
    (a, b) => a.record_start_time - b.record_start_time || a.id - b.id,
  );
  const first = sorted[0];
  const latest = sorted.at(-1)!;
  const liveStarts = sorted
    .map((record) => liveStartMilliseconds(record.live_start_time))
    .filter((v): v is number => v !== null);
  const startTime = liveStarts.length ? Math.min(...liveStarts) : first.record_start_time;
  const endTime = sorted.reduce(
    (end, record) =>
      Math.max(
        end,
        record.record_end_time || record.record_start_time + (record.video_duration || 0) * 1000,
      ),
    startTime,
  );
  const sessionKey = recordSessionKey(first);
  return {
    key: `${streamer.id}:${sessionKey}`,
    sessionKey,
    streamerId: streamer.id,
    streamerName: streamer.name,
    roomId: streamer.roomId,
    platform: streamer.platform,
    title: latest.title,
    liveStartTime: startTime,
    startTime,
    recordStartTime: first.record_start_time,
    lastRecordTime: latest.record_start_time,
    date: dateInZone(startTime, timeZone),
    timeZone,
    crossesMidnight: dateInZone(startTime, timeZone) !== dateInZone(endTime, timeZone),
    clipCount: sorted.length,
    totalDuration: sorted.reduce((n, record) => n + (record.video_duration || 0), 0),
    watch: sessionWatch(sorted),
  };
}

function streamerSessions(
  streamer: NonNullable<ReturnType<typeof libraryStreamer>>,
  timeZone: string,
) {
  const records = getMainDb()
    .prepare(
      `SELECT * FROM record_history
    WHERE streamer_id = ? AND coalesce(video_file, '') != '' ORDER BY record_start_time, id`,
    )
    .all(streamer.id) as LiveHistory[];
  const grouped = new Map<string, LiveHistory[]>();
  for (const record of records) {
    const key = recordSessionKey(record);
    const clips = grouped.get(key) || [];
    clips.push(record);
    grouped.set(key, clips);
  }
  return [...grouped.values()]
    .map((clips) => describeSession(streamer, clips, timeZone))
    .sort((a, b) => b.startTime - a.startTime || b.lastRecordTime - a.lastRecordTime);
}

export function streamerLibrary(
  search: string,
  offset: number,
  limit: number,
  includeHidden = false,
) {
  const hidden = new Set(watchHistoryStore.hiddenStreamerIds());
  const visibility =
    includeHidden || !hidden.size
      ? ""
      : ` AND s.id NOT IN (${[...hidden].map(() => "?").join(",")})`;
  const parameters = [search, search, ...(includeHidden ? [] : hidden)];
  const filter = `EXISTS (SELECT 1 FROM record_history r WHERE r.streamer_id = s.id
    AND coalesce(r.video_file, '') != '' AND (? = '' OR instr(lower(s.name || ' ' || s.room_id || ' ' || coalesce(r.title, '')), lower(?)) > 0))`;
  const total = (
    getMainDb()
      .prepare(`SELECT count(*) AS total FROM streamer s WHERE ${filter}${visibility}`)
      .get(...parameters) as { total: number }
  ).total;
  const rows = getMainDb()
    .prepare(
      `SELECT s.id FROM streamer s WHERE ${filter}${visibility}
    ORDER BY (SELECT max(record_start_time) FROM record_history WHERE streamer_id = s.id) DESC, s.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...parameters, limit, offset) as Array<{ id: number }>;
  const timeZone = libraryTimeZone();
  const data = rows.map((row) => {
    const streamer = libraryStreamer(row.id)!;
    const sessions = streamerSessions(streamer, timeZone);
    return {
      ...streamer,
      hidden: hidden.has(streamer.id),
      sessionCount: sessions.length,
      unwatchedCount: sessions.filter((session) => session.watch.status === "unwatched").length,
      watchingCount: sessions.filter((session) => session.watch.status === "watching").length,
      completedCount: sessions.filter((session) => session.watch.completed).length,
      latestSession: sessions[0] || null,
    };
  });
  return {
    data,
    total,
    nextOffset: offset + data.length < total ? offset + data.length : null,
    timeZone,
  };
}

export function streamerCalendar(id: number, month?: string, zone?: string) {
  const streamer = libraryStreamer(id);
  if (!streamer) return null;
  const timeZone = libraryTimeZone(zone);
  const all = streamerSessions(streamer, timeZone);
  const availableMonths = [...new Set(all.map((session) => session.date.slice(0, 7)))]
    .sort()
    .reverse();
  const selectedMonth = month || availableMonths[0] || dateInZone(Date.now(), timeZone).slice(0, 7);
  const sessions = all.filter((session) => session.date.startsWith(`${selectedMonth}-`));
  const dates = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const day = dates.get(session.date) || [];
    day.push(session);
    dates.set(session.date, day);
  }
  const days = [...dates].map(([date, items]) => {
    const completedCount = items.filter((session) => session.watch.completed).length;
    const completed = completedCount === items.length;
    const totalClips = items.reduce((n, session) => n + session.clipCount, 0);
    const completedClips = items.reduce((n, session) => n + session.watch.completedCount, 0);
    return {
      date,
      sessionCount: items.length,
      completedCount,
      totalClips,
      completedClips,
      status: completed
        ? "completed"
        : items.some((session) => session.watch.status !== "unwatched")
          ? "watching"
          : "unwatched",
    };
  });
  return {
    streamer,
    timeZone,
    month: selectedMonth,
    availableMonths,
    today: dateInZone(Date.now(), timeZone),
    days,
    sessions,
  };
}

export function sessionDescription(streamerId: number, sessionKey: string) {
  const streamer = libraryStreamer(streamerId);
  const records = sessionRecords(streamerId, sessionKey);
  return streamer && records.length ? describeSession(streamer, records) : null;
}
