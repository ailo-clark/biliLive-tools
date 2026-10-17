// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => ({
  defaults: { headers: { Authorization: "desktop-key" } },
  getUri: vi.fn(({ url }: { url: string }) => "/api" + url),
}));
vi.mock("@renderer/apis/request", () => ({ default: request }));
import { keepaliveUpdate } from "../src/renderer/src/apis/watchHistory";

describe("background watch progress responses", () => {
  const state = { key: "record:one", revision: 3, position: 80, completed: false };
  const update = { revision: 2, action: "progress" as const, position: 80 };
  const fetch = vi.fn();
  beforeEach(() => {
    fetch.mockReset();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { localStorage: { getItem: () => "browser-key" } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the acknowledged revision and uses the existing authentication", async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }));
    expect(await keepaliveUpdate(state.key, update)).toEqual({ conflict: false, state });
    expect(fetch).toHaveBeenCalledWith(
      "/api/watch-history/record:one",
      expect.objectContaining({
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: "browser-key" },
        body: JSON.stringify(update),
      }),
    );
  });
  it("returns genuine conflicts with the current state instead of treating them as saved", async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify(state), { status: 409 }));
    expect(await keepaliveUpdate(state.key, update)).toEqual({ conflict: true, state });
  });
  it("rejects failed HTTP responses so the local pending progress is retained", async () => {
    fetch.mockResolvedValue(new Response("failure", { status: 500 }));
    await expect(keepaliveUpdate(state.key, update)).rejects.toThrow("HTTP 500");
  });
  it("keeps desktop authentication when browser storage has no key", async () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    fetch.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }));
    await keepaliveUpdate(state.key, update);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("desktop-key");
  });

  it("times out a hung background request so it cannot block all later saves", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const result = expect(keepaliveUpdate(state.key, update)).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(5000);
    await result;
  });
});
