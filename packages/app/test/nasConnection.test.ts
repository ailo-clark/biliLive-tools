// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("pins numeric and u-prefixed NAS URLs to the plugin API while supporting a root preview", async () => {
  const { nasApiBase } = await import("../src/renderer/src/apis/authStorage");
  expect(nasApiBase("/plugin/12345/bililivereplay/index.html")).toBe(
    "/plugin/12345/bililivereplay/api",
  );
  expect(nasApiBase("/plugin/u12345/bililivereplay/index.html")).toBe(
    "/plugin/u12345/bililivereplay/api",
  );
  expect(nasApiBase("/index.html")).toBe("/api");
});
it("isolates replay credentials from other NAS applications and preserves their keys on logout", async () => {
  vi.stubEnv("VITE_NAS_REPLAY", "true");
  vi.resetModules();
  const values = new Map([["key", "other-app-key"]]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const { getAuthKey, setAuthKey, clearAuthKey } = await import(
    "../src/renderer/src/apis/authStorage"
  );
  expect(getAuthKey()).toBe("");
  setAuthKey("replay-key");
  expect(getAuthKey()).toBe("replay-key");
  clearAuthKey();
  expect(values.get("key")).toBe("other-app-key");
});
