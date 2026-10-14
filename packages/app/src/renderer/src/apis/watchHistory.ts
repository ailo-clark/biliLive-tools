import request from "./request";

export interface WatchState {
  key: string;
  filePath: string;
  title: string;
  recordId?: number | null;
  position: number;
  duration: number;
  completed: boolean;
  revision: number;
  updatedAt: number;
  lastPlayedAt: number;
}

export type WatchSource = { recordId?: number; videoId?: string };
export interface SessionWatchState {
  status: "unwatched" | "watching" | "completed";
  completed: boolean;
  completedCount: number;
  totalCount: number;
  lastPlayedAt: number;
}
export interface WatchSession {
  key: string;
  sessionKey: string;
  streamerId: number;
  streamerName: string;
  roomId: string;
  platform: string;
  title: string;
  liveStartTime: number | null;
  recordStartTime: number;
  clipCount: number;
  totalDuration: number;
  watch: SessionWatchState;
  startTime?: number;
  date?: string;
  crossesMidnight?: boolean;
  timeZone?: string;
}
export interface WatchClip {
  id: number;
  title: string;
  record_start_time: number;
  video_duration?: number;
  watch: WatchState | null;
}
export interface WatchStreamer {
  id: number;
  name: string;
  roomId: string;
  platform: string;
  avatar: string | null;
  sessionCount: number;
  unwatchedCount: number;
  watchingCount: number;
  completedCount: number;
  latestSession: WatchSession | null;
}
export interface CalendarDay {
  date: string;
  sessionCount: number;
  completedCount: number;
  totalClips: number;
  completedClips: number;
  status: "unwatched" | "watching" | "completed";
}
export interface WatchCalendar {
  streamer: Pick<WatchStreamer, "id" | "name" | "roomId" | "platform" | "avatar">;
  month: string;
  timeZone: string;
  today: string;
  availableMonths: string[];
  days: CalendarDay[];
  sessions: WatchSession[];
}
export type WatchAction = "progress" | "completed" | "unwatched" | "restart";
export interface WatchUpdate {
  revision: number;
  action: WatchAction;
  position?: number;
  duration?: number;
}

export const resolve = async (source: WatchSource): Promise<WatchState> =>
  (await request.post("/watch-history/resolve", source)).data;
export const get = async (key: string): Promise<WatchState> =>
  (await request.get(`/watch-history/${key}`)).data;

export async function update(key: string, payload: WatchUpdate) {
  try {
    return {
      conflict: false,
      state: (await request.put(`/watch-history/${key}`, payload, { timeout: 5000 }))
        .data as WatchState,
    };
  } catch (error: any) {
    // The existing request interceptor returns response bodies, including conflicts.
    if (error?.key === key && typeof error?.revision === "number") {
      return { conflict: true, state: error as WatchState };
    }
    throw error;
  }
}

export async function recent(
  status: "all" | "watching" | "completed" = "all",
  offset = 0,
): Promise<WatchState[]> {
  return (await request.get("/watch-history/recent", { params: { status, offset } })).data;
}

export async function library(params: { before?: number; status?: string; search?: string }) {
  return (await request.get("/watch-history/library", { params })).data as {
    data: Array<{
      id: number;
      title: string;
      streamer_name: string;
      platform: string;
      room_id: string;
      record_start_time: number;
      video_duration?: number;
      watch: WatchState | null;
    }>;
    nextCursor: number | null;
  };
}

export const play = async (
  key: string,
): Promise<{ videoId: string; filePath: string; recordId?: number }> =>
  (await request.get(`/watch-history/${key}/play`)).data;

export async function sessions(
  params: {
    streamerId?: number;
    before?: number;
    offset?: number;
    limit?: number;
    status?: string;
    search?: string;
    recent?: boolean;
  } = {},
) {
  return (await request.get("/watch-history/sessions", { params })).data as {
    data: WatchSession[];
    nextCursor: number | null;
  };
}
export async function sessionClips(session: Pick<WatchSession, "streamerId" | "sessionKey">) {
  return (await request.post("/watch-history/session-clips", session)).data as {
    data: WatchClip[];
    watch: SessionWatchState;
    session: WatchSession;
  };
}
export async function streamers(params: { search?: string; offset?: number } = {}) {
  return (await request.get("/watch-history/streamers", { params })).data as {
    data: WatchStreamer[];
    total: number;
    nextOffset: number | null;
    timeZone: string;
  };
}
export async function calendar(streamerId: number, month?: string) {
  return (await request.get(`/watch-history/calendar/${streamerId}`, { params: { month } }))
    .data as WatchCalendar;
}
export function sessionWatchLabel(watch?: SessionWatchState) {
  if (!watch) return "未观看";
  const label = watch.completed ? "已看完" : watch.status === "watching" ? "观看中" : "未观看";
  if (watch.completed) return `${label} · ${watch.completedCount}/${watch.totalCount} 段`;
  return `${label} · 已看完 ${watch.completedCount}/${watch.totalCount} 段`;
}

export function keepaliveUpdate(key: string, payload: WatchUpdate) {
  const authorization =
    window.localStorage.getItem("key") || String(request.defaults.headers.Authorization || "");
  return fetch(request.getUri({ url: `/watch-history/${key}` }), {
    method: "PUT",
    keepalive: true,
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify(payload),
  });
}

export function watchLabel(state?: WatchState | null) {
  if (state?.completed) return "已看完";
  if (state?.lastPlayedAt) {
    const minutes = Math.floor(state.position / 60);
    const seconds = Math.floor(state.position % 60)
      .toString()
      .padStart(2, "0");
    return `观看中 · ${minutes}:${seconds}`;
  }
  return "未观看";
}

export default {
  resolve,
  get,
  update,
  recent,
  library,
  sessions,
  sessionClips,
  streamers,
  calendar,
  play,
};
