import router from "./router";
import watchApi, { type WatchSession } from "@renderer/apis/watchHistory";
import { commonApi, recordHistoryApi } from "@renderer/apis";

export async function playSession(
  session: Pick<WatchSession, "streamerId" | "sessionKey">,
  recordId?: number,
) {
  await router.push({
    name: "MobileSessionPlayer",
    query: {
      streamerId: String(session.streamerId),
      sessionKey: session.sessionKey,
      ...(recordId ? { recordId: String(recordId) } : {}),
    },
  });
}
export async function playRecord(recordId: number) {
  const file = await recordHistoryApi.getFileInfo(recordId);
  await router.push({
    name: "MobilePlayer",
    query: {
      videoId: file.videoFileId,
      type: file.videoFileExt,
      recordId: String(recordId),
      danmaId: file.danmaFileId || undefined,
    },
  });
}
export async function playWatch(key: string) {
  const source = await watchApi.play(key);
  if (source.recordId) return playRecord(source.recordId);
  const file = await commonApi.applyVideoId(source.filePath);
  await router.push({ name: "MobilePlayer", query: { videoId: file.videoId, type: file.type } });
}
