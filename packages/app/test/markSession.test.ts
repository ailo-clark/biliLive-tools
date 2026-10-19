// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ sessionClips: vi.fn(), resolve: vi.fn(), update: vi.fn() }));
vi.mock("@renderer/apis/watchHistory", () => ({ default: api }));
import { markSessionCompleted } from "../src/renderer/src/utils/markSession";

describe("mark a complete recording session watched", () => {
  const session = { streamerId: 1, sessionKey: "live:one" };
  const states = new Map<number, any>();
  beforeEach(() => {
    vi.clearAllMocks();
    states.clear();
    states.set(1, { key: "record:1", revision: 2, completed: false, position: 75, duration: 120 });
    states.set(2, { key: "record:2", revision: 3, completed: true, position: 90, duration: 120 });
    states.set(3, { key: "record:3", revision: 4, completed: false, position: 0, duration: 120 });
    api.sessionClips.mockImplementation(async () => ({
      data: [...states.keys()].map((id) => ({ id })),
    }));
    api.resolve.mockImplementation(async ({ recordId }) => ({ ...states.get(recordId) }));
    api.update.mockImplementation(async (key, update) => {
      const state = states.get(Number(key.split(":")[1]));
      Object.assign(state, { revision: update.revision + 1, completed: true });
      return { conflict: false, state: { ...state } };
    });
  });
  it("marks all remaining segments and preserves saved positions and completed segments", async () => {
    await markSessionCompleted(session);
    expect([...states.values()].every((state) => state.completed)).toBe(true);
    expect([...states.values()].map((state) => state.position)).toEqual([75, 90, 0]);
    expect(states.get(2).revision).toBe(3);
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(api.update).toHaveBeenCalledWith("record:1", { revision: 2, action: "completed" });
  });
  it("stops on a genuine conflict without overwriting it or marking later segments", async () => {
    api.update.mockResolvedValueOnce({ conflict: true });
    await expect(markSessionCompleted(session)).rejects.toThrow("其他页面");
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(states.get(1).completed).toBe(false);
    expect(states.get(3).completed).toBe(false);
  });
  it("can retry a partially failed session without resetting successful progress", async () => {
    const commit = api.update.getMockImplementation()!;
    api.update.mockImplementationOnce(commit).mockRejectedValueOnce(new Error("offline"));
    await expect(markSessionCompleted(session)).rejects.toThrow("offline");
    expect(states.get(1).completed).toBe(true);
    expect(states.get(3).completed).toBe(false);
    await markSessionCompleted(session);
    expect(states.get(1).revision).toBe(3);
    expect(states.get(3).completed).toBe(true);
  });
});
