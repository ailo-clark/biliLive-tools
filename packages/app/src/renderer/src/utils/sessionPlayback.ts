import type { WatchClip } from "@renderer/apis/watchHistory";
export function resumeClip(clips: WatchClip[]) {
  const inProgress = clips
    .filter((clip) => !clip.watch?.completed && clip.watch?.lastPlayedAt)
    .sort((a, b) => (b.watch?.lastPlayedAt || 0) - (a.watch?.lastPlayedAt || 0));
  return inProgress[0] || clips.find((clip) => !clip.watch?.completed) || clips[0];
}
