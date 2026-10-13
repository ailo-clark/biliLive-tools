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
      state: (await request.put(`/watch-history/${key}`, payload)).data as WatchState,
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

export default { resolve, get, update, recent, library, play };
