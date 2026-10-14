// @vitest-environment node
import { describe, expect, it } from "vitest";
import { monthCells, shiftMonth } from "../src/renderer/src/utils/watchCalendar";
import { resumeClip } from "../src/renderer/src/utils/sessionPlayback";
import type { WatchClip } from "../src/renderer/src/apis/watchHistory";
describe("calendar and session resume", () => {
  it("builds Monday-first grids with complete weeks and leap days", () => {
    const cells = monthCells("2024-02");
    expect(cells).toHaveLength(35);
    expect(cells[0].date).toBe("2024-01-29");
    expect(cells.filter((cell) => cell.current)).toHaveLength(29);
    expect(cells.find((cell) => cell.date === "2024-02-29")?.current).toBe(true);
    expect(monthCells("2026-03")).toHaveLength(42);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("resumes the most recently played unfinished clip, then the first unwatched clip", () => {
    const clips = [
      { id: 1, watch: { completed: true, lastPlayedAt: 300 } },
      { id: 2, watch: { completed: false, lastPlayedAt: 100 } },
      { id: 3, watch: { completed: false, lastPlayedAt: 200 } },
      { id: 4, watch: null },
    ] as WatchClip[];
    expect(resumeClip(clips)?.id).toBe(3);
    expect(resumeClip([clips[0], clips[3]])?.id).toBe(4);
    expect(resumeClip([clips[0]])?.id).toBe(1);
    expect(resumeClip([])).toBeUndefined();
  });
});
