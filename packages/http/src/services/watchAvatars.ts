import { watchHistoryStore } from "@biliLive-tools/shared/db/index.js";
import { container, appConfig } from "../index.js";

type Profile = { id: number; roomId: string; platform: string };
const requests = new Map<string, Promise<string | null>>();
const waiting: Array<() => void> = [];
let active = 0;
const identity = (profile: Profile) => `${profile.platform.toLowerCase()}:${profile.roomId}`;
const key = (profile: Profile) => `streamer-avatar:${profile.id}`;
const imageURL = (value: unknown): string | null =>
  typeof value === "string" && /^(https?:)?\/\//.test(value)
    ? value.startsWith("//")
      ? `https:${value}`
      : value
    : null;
const manager = () => container?.resolve("recorderManager")?.manager;
const runtimeRecorder = (profile: Profile) =>
  manager()?.recorders.find(
    (recorder) =>
      String(recorder.channelId) === profile.roomId &&
      recorder.providerId.toLowerCase() === profile.platform.toLowerCase(),
  );

function cached(profile: Profile): { avatar: string | null; expiresAt: number } | undefined {
  try {
    const value = JSON.parse(watchHistoryStore.metadata(key(profile)) || "null");
    if (value?.identity === identity(profile)) return value;
  } catch {
    /* An unavailable avatar must not prevent browsing recordings. */
  }
  return undefined;
}

export function streamerAvatarSnapshot(profile: Profile): string | null {
  const recorder = runtimeRecorder(profile);
  const configured = appConfig
    ?.get("recorders")
    ?.find(
      (item) =>
        String(item.channelId) === profile.roomId &&
        item.providerId.toLowerCase() === profile.platform.toLowerCase(),
    );
  return (
    imageURL(cached(profile)?.avatar) ||
    imageURL(recorder?.liveInfo?.avatar) ||
    imageURL(recorder?.extra?.avatar) ||
    imageURL(configured?.extra?.avatar) ||
    null
  );
}

async function withSlot<T>(fetch: () => Promise<T>) {
  if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fetch();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export function refreshStreamerAvatar(profile: Profile): Promise<string | null> {
  const previous = cached(profile);
  if (previous && previous.expiresAt > Date.now())
    return Promise.resolve(streamerAvatarSnapshot(profile));
  const requestKey = `${profile.id}:${identity(profile)}`;
  if (requests.has(requestKey)) return requests.get(requestKey)!;
  const request = withSlot(async () => {
    let avatar = streamerAvatarSnapshot(profile);
    let expiresAt = Date.now() + 60_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const currentManager = manager();
      const provider = currentManager?.providers.find(
        (item) => item.id.toLowerCase() === profile.platform.toLowerCase(),
      );
      // Unregistered history uses a temporary reader, never added to the recording manager.
      const recorder =
        runtimeRecorder(profile) ||
        provider?.createRecorder({
          channelId: profile.roomId,
          quality: "highest",
          streamPriorities: [],
          sourcePriorities: [],
          disableAutoCheck: true,
        });
      if (recorder) {
        const info = await Promise.race([
          recorder.getLiveInfo(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("头像请求超时")), 8000);
          }),
        ]);
        avatar = imageURL(info.avatar) || avatar;
        expiresAt = Date.now() + 20 * 60_000;
      }
    } catch {
      /* Keep the last successful image and retry later. */
    } finally {
      clearTimeout(timer);
    }
    watchHistoryStore.setMetadata(
      key(profile),
      JSON.stringify({ identity: identity(profile), avatar, expiresAt }),
    );
    return avatar;
  }).finally(() => requests.delete(requestKey));
  requests.set(requestKey, request);
  return request;
}
