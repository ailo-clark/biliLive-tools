// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ReplayLoginError, verifyReplayLogin } from "../nas-replay/login";
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
it.each([
  "/D:/plugin/12345/bililivereplay/index.html",
  "/C:/plugin/u12345/bililivereplay/index.html",
  "/desktop/cache/plugin/12345/bililivereplay/index.html",
])("extracts the plugin API from a desktop client path: %s", async (pathname) => {
  const { nasApiBase } = await import("../src/renderer/src/apis/authStorage");
  const uid = pathname.includes("u12345") ? "u12345" : "12345";
  expect(nasApiBase(pathname)).toBe(`/plugin/${uid}/bililivereplay/api`);
});
it.each([
  "/plugin/12345/another-plugin/index.html",
  "/plugin/12345/bililivereplay-other/index.html",
  "/plugin/u0/bililivereplay/index.html",
])("does not claim other plugin paths: %s", async (pathname) => {
  const { nasApiBase } = await import("../src/renderer/src/apis/authStorage");
  expect(nasApiBase(pathname)).toBe("/api");
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

it("validates both authenticated endpoints before accepting a login", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ status: 200, data: "2.0.0-beta.1" })
    .mockResolvedValueOnce({ status: 200, data: { data: [], total: 0 } });
  await verifyReplayLogin({ get }, "replay-key");
  expect(get.mock.calls.map(([url]) => url)).toEqual([
    "/common/version",
    "/watch-history/streamers",
  ]);
  expect(get.mock.calls[0][1]).toMatchObject({
    headers: { Authorization: "replay-key" },
    timeout: 10000,
  });
  expect(get.mock.calls[0][1].validateStatus(401)).toBe(true);
});

it.each([
  [401, "登录密钥不正确"],
  [403, "NAS 拒绝访问"],
  [404, "插件接口未找到"],
  [418, "HTTP 418"],
  [502, "无法连接 Docker"],
  [503, "无法连接 Docker"],
  [504, "无法连接 Docker"],
])("reports HTTP %s without reflecting the response body or key", async (status, message) => {
  const get = vi.fn().mockResolvedValue({ status, data: "private response" });
  await expect(verifyReplayLogin({ get }, "private passkey")).rejects.toThrow(message);
  try {
    await verifyReplayLogin({ get }, "private passkey");
  } catch (error) {
    expect(error).toBeInstanceOf(ReplayLoginError);
    expect(String(error)).not.toContain("private");
  }
});

it("distinguishes a backend missing viewing endpoints from a missing plugin route", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ status: 200, data: "2.0.0" })
    .mockResolvedValueOnce({ status: 404, data: "not found" });
  await expect(verifyReplayLogin({ get }, "key")).rejects.toThrow("Docker 缺少观看接口");
});

it.each([[{ status: 200, data: "<html>NAS login</html>" }], [{ status: 200, data: { code: 0 } }]])(
  "rejects a successful HTTP response from the wrong service",
  async (response) => {
    const get = vi.fn().mockResolvedValue(response);
    await expect(verifyReplayLogin({ get }, "key")).rejects.toThrow("非预期内容");
  },
);

it("rejects a non-streamer response after a valid version", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ status: 200, data: "2.0.0" })
    .mockResolvedValueOnce({ status: 200, data: "<html>NAS page</html>" });
  await expect(verifyReplayLogin({ get }, "key")).rejects.toThrow("非预期内容");
});
