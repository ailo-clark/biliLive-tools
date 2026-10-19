import watchApi, { type WatchSession } from "@renderer/apis/watchHistory";

// Existing per-clip APIs keep this compatible with the published Docker backend.
// Preserve each clip's position/duration and stop on conflicts instead of silently
// overwriting another viewer. A partial failure is safe to retry.
export async function markSessionCompleted(
  session: Pick<WatchSession, "streamerId" | "sessionKey">,
) {
  const { data } = await watchApi.sessionClips(session);
  if (!data.length) throw new Error("该场次没有可标记的分段");
  let completed = 0;
  for (const clip of data) {
    const state = await watchApi.resolve({ recordId: clip.id });
    if (!state.completed) {
      const result = await watchApi.update(state.key, {
        revision: state.revision,
        action: "completed",
      });
      if (result.conflict) {
        throw new Error(
          `观看状态已在其他页面更新，已完成 ${completed}/${data.length} 段，请刷新后重试`,
        );
      }
    }
    completed++;
  }
}
