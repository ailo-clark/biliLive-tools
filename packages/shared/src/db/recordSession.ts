import type { LiveHistory } from "./model/recordHistory.js";
import type { WatchState } from "./watchHistory.js";

export function recordSessionKey(record: Pick<LiveHistory, "id" | "live_id" | "live_start_time">) {
  if (record.live_id) return `live:${record.live_id}`;
  if (record.live_start_time && record.live_start_time > 0)
    return `start:${record.live_start_time}`;
  // Don't merge unrelated unidentified streams into one giant session.
  return `record:${record.id}`;
}

export const sessionKeySQL = `CASE WHEN coalesce(r.live_id, '') != '' THEN 'live:' || r.live_id
  WHEN coalesce(r.live_start_time, 0) > 0 THEN 'start:' || r.live_start_time
  ELSE 'record:' || r.id END`;

export interface SessionWatchState {
  status: "unwatched" | "watching" | "completed";
  completed: boolean;
  completedCount: number;
  totalCount: number;
  lastPlayedAt: number;
}

export function summarizeSessionWatch(states: Array<WatchState | null>): SessionWatchState {
  const completedCount = states.filter((state) => state?.completed).length;
  const lastPlayedAt = states.reduce(
    (latest, state) => Math.max(latest, state?.lastPlayedAt || 0),
    0,
  );
  const completed = states.length > 0 && completedCount === states.length;
  return {
    completed,
    completedCount,
    totalCount: states.length,
    lastPlayedAt,
    status: completed ? "completed" : completedCount || lastPlayedAt ? "watching" : "unwatched",
  };
}
