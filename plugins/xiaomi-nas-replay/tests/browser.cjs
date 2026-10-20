// Requires the existing monorepo's compiled CLI/shared packages, ffmpeg,
// Chromium, Playwright and nginx. All data/services below are disposable fixtures.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { randomBytes, createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const pkg = path.resolve(__dirname, "..");
const repo = process.env.BILILIVE_REPO || path.resolve(pkg, "../..");
const nginx = process.env.NGINX_BIN || "nginx";
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || path.join(repo, "node_modules/playwright"),
);
const Database = require(path.join(repo, "packages/shared/node_modules/better-sqlite3"));
const root =
  process.env.PLUGIN_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), "bililive-plugin-e2e-"));
fs.mkdirSync(root, { recursive: true });
fs.rmSync(path.join(root, "result.json"), { force: true });
fs.rmSync(path.join(root, "data"), { recursive: true, force: true });
fs.mkdirSync(path.join(root, "data"));
fs.mkdirSync(path.join(root, "videos"), { recursive: true });
const secret = randomBytes(32).toString("hex");
const prefix = "/plugin/12345/bililivereplay";
const origin = "http://127.0.0.1:18043";
const headers = {
  Authorization: secret,
  Cookie: "nas_test=local-auth",
  "Content-Type": "application/json",
};
let backend, browser;
const children = [];
function child(cmd, args, options = {}) {
  const fd = fs.openSync(path.join(root, "services.log"), "a");
  const proc = spawn(cmd, args, { stdio: ["ignore", fd, fd], ...options });
  fs.closeSync(fd);
  children.push(proc);
  return proc;
}
function launch() {
  backend = child(
    process.execPath,
    [path.join(repo, "packages/CLI/lib/index.cjs"), "server", "-c", path.join(root, "config.json")],
    {
      cwd: path.join(repo, "packages/CLI"),
      env: {
        ...process.env,
        TZ: "Asia/Shanghai",
        BILILIVE_TOOLS_PASSKEY: secret,
      },
    },
  );
}
async function stop(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise((resolve) => {
    proc.once("exit", resolve);
    proc.kill("SIGTERM");
  });
}
async function ready(url, init) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url, init)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Service did not become ready: " + url);
}
const api = (url, method = "GET", data) =>
  fetch(origin + prefix + "/api" + url, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
async function main() {
  const config = {
    port: 18041,
    host: "127.0.0.1",
    configFolder: path.join(root, "data"),
    ffmpegPath: "/usr/bin/ffmpeg",
    ffprobePath: "/usr/bin/ffprobe",
    mesioPath: "mesio",
    bililiveRecorderPath: "BililiveRecorder.Cli",
    audiowaveformPath: "audiowaveform",
    danmakuFactoryPath: "DanmakuFactory",
    logPath: path.join(root, "main.log"),
  };
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(config));
  launch();
  await ready("http://127.0.0.1:18041/common/version", {
    headers: { Authorization: secret },
  });

  await stop(backend);
  const appConfigPath = path.join(root, "data/appConfig.json");
  const appConfig = JSON.parse(fs.readFileSync(appConfigPath));
  appConfig.recorder.savePath = path.join(root, "videos");
  appConfig.recorders = [];
  fs.writeFileSync(appConfigPath, JSON.stringify(appConfig));
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=480x270:rate=10",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-t",
    "120",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    path.join(root, "videos/clip.mp4"),
  ]);
  const db = new Database(path.join(root, "data/app.db"));
  db.prepare("INSERT INTO streamer (id,name,room_id,platform) VALUES (9001,?,?,?)").run(
    "回放测试主播",
    "9001",
    "Bilibili",
  );
  const start = Date.parse("2026-10-15T12:00:00Z");
  const insert = db.prepare(
    "INSERT INTO record_history (id,streamer_id,live_id,live_start_time,record_start_time,record_end_time,title,video_file,video_duration) VALUES (?,9001,?,?,?,?,?,?,12)",
  );
  for (let i = 0; i < 3; i++)
    insert.run(
      9001 + i,
      "plugin-live",
      start,
      start + i * 12000,
      start + (i + 1) * 12000,
      "回放测试·上午场",
      path.join(root, "videos/clip.mp4"),
    );
  for (let i = 0; i < 2; i++)
    insert.run(
      9004 + i,
      "afternoon-live",
      start + 3600000,
      start + 3600000 + i * 12000,
      start + 3600000 + (i + 1) * 12000,
      "回放测试·下午场",
      path.join(root, "videos/clip.mp4"),
    );
  const records = db.prepare("SELECT * FROM record_history").all();
  const schema = db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
  db.close();
  const { WatchHistoryStore, recordWatchKey } = await import(
    pathToFileURL(path.join(repo, "packages/shared/lib/db/watchHistory.js"))
  );
  const store = new WatchHistoryStore(path.join(root, "data"));
  store.initializeExistingRecords(records);
  for (const record of records) {
    const state = store.ensure({
      key: recordWatchKey(record),
      filePath: record.video_file,
      title: record.title,
      recordId: record.id,
    });
    assert(store.update(state.key, { revision: state.revision, action: "unwatched" }).state);
  }
  const first = store.get(recordWatchKey(records[0]));
  assert.equal(
    store.update(first.key, {
      revision: first.revision,
      action: "progress",
      position: 7,
      duration: 12,
    }).state.position,
    7,
  );
  store.close();
  launch();
  await ready("http://127.0.0.1:18041/common/version", {
    headers: { Authorization: secret },
  });
  execFileSync("python3", [
    path.join(__dirname, "render_test_nginx.py"),
    root,
    path.join(pkg, "src/ui"),
  ]);
  child("python3", [path.join(__dirname, "static_server.py"), "18044"]);
  execFileSync(nginx, ["-p", root + "/", "-c", path.join(root, "nginx.conf"), "-t"]);
  child(nginx, ["-p", root + "/", "-c", path.join(root, "nginx.conf"), "-g", "daemon off;"]);
  await ready(origin + prefix + "/api/common/version", { headers });
  assert.equal((await fetch(origin + prefix + "/index.html")).status, 403);
  assert.equal(
    (await fetch(origin + prefix + "/api/common/version", { headers: { Authorization: secret } }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + prefix + "/api/common/version", {
        headers: { Cookie: "nas_test=local-auth" },
      })
    ).status,
    401,
  );
  assert.equal((await fetch(origin + "/api/common/version", { headers })).status, 418);
  const html = await (await fetch(origin + prefix + "/index.html", { headers })).text();
  assert.equal(html, fs.readFileSync(path.join(pkg, "src/ui/index.html"), "utf8"));
  assert(!html.includes("bridge.js") && !html.includes("iframe"));
  assert.equal((await fetch("http://127.0.0.1:18042/index.html")).status, 404);
  const file = await (await api("/record-history/file/9001")).json();
  const videoURL = origin + prefix + "/api/common/video/" + file.videoFileId;
  const bytes = fs.readFileSync(path.join(root, "videos/clip.mp4"));
  const partial = await fetch(videoURL, { headers: { ...headers, Range: "bytes=20-99" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes 20-99/${bytes.length}`);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(20, 100));
  const full = await fetch(videoURL, { headers });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-length"), String(bytes.length));
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  assert.equal(
    (await fetch(videoURL, { headers: { ...headers, Range: `bytes=${bytes.length}-` } })).status,
    416,
  );
  console.log(
    "PASS dedicated static frontend, Docker HTML unavailable, NAS auth, scoped API, real video 200/206/416",
  );
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  const errors = [];
  const contexts = [];
  async function context(mobile, entryPrefix = mobile ? prefix : "/D:" + prefix) {
    const ctx = await browser.newContext(
      mobile
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            userAgent:
              "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
          }
        : { viewport: { width: 1440, height: 1000 } },
    );
    contexts.push(ctx);
    await ctx.addCookies([{ name: "nas_test", value: "local-auth", url: origin }]);
    // Stale credentials/API settings belonging to another app must have no effect.
    await ctx.addInitScript(() => {
      localStorage.setItem("key", "other-app-key");
      localStorage.setItem("api", "/api");
    });
    const page = await ctx.newPage();
    const apiRequests = [];
    page.on("request", (request) => {
      if (["xhr", "fetch"].includes(request.resourceType()))
        apiRequests.push(new URL(request.url()).pathname);
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + entryPrefix + "/index.html#/mobile");
    await page.getByPlaceholder("输入 BILILIVE_TOOLS_PASSKEY").fill("wrong-test-key");
    await page.getByRole("button", { name: "进入回放", exact: true }).click();
    await page
      .getByText("登录密钥不正确，请检查 BILILIVE_TOOLS_PASSKEY", { exact: true })
      .waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("nas-replay:key")), null);
    await page.getByPlaceholder("输入 BILILIVE_TOOLS_PASSKEY").fill(secret);
    await page.getByRole("button", { name: "进入回放", exact: true }).click();
    await page.getByRole("button", { name: "查看 回放测试主播 的录播日历", exact: true }).waitFor();
    const canonical = entryPrefix.slice(entryPrefix.indexOf("/plugin/")) + "/api/";
    assert(apiRequests.length >= 3);
    assert(
      apiRequests.every((url) => url.startsWith(canonical)),
      "all login and viewing APIs must use the canonical plugin route: " + apiRequests.join(", "),
    );
    assert.equal(await page.evaluate(() => localStorage.getItem("key")), "other-app-key");
    assert.equal(await page.evaluate(() => !!document.querySelector("iframe")), false);
    assert(!(await page.locator("body").innerText()).includes("系统设置"));
    return page;
  }
  async function until(check, description) {
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out: " + description);
  }
  const read = async (id) =>
    (
      await api("/watch-history/" + recordWatchKey(records.find((record) => record.id === id)))
    ).json();
  const desktop = await context(false);
  await desktop.getByRole("button", { name: "查看 回放测试主播 的录播日历", exact: true }).click();
  await desktop.getByRole("button", { name: /2026-10-15，2 场录像/ }).click();
  assert.equal(await desktop.locator(".day-session-row").count(), 2);
  await desktop
    .getByRole("button", { name: "将场次 回放测试·下午场 标记已看", exact: true })
    .click();
  await until(
    async () => (await read(9004)).completed && (await read(9005)).completed,
    "all afternoon segments marked watched",
  );
  await desktop.getByRole("button", { name: /2026-10-15，2 场录像，1 场已看完/ }).waitFor();
  assert.equal((await read(9001)).position, 7);
  assert.equal((await read(9001)).completed, false);
  const marked = desktop.getByRole("button", {
    name: "将场次 回放测试·下午场 标记已看",
    exact: true,
  });
  assert.equal(await marked.isDisabled(), true);
  assert.equal(
    await desktop.locator("video").count(),
    0,
    "marking watched must not start playback",
  );
  await desktop.screenshot({ path: path.join(root, "desktop-calendar.png"), fullPage: true });
  await desktop.keyboard.press("Escape");
  await desktop.locator(".theme-select").click();
  await desktop
    .locator(".n-base-select-option__content")
    .filter({ hasText: /^深色$/ })
    .click();
  await desktop.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await desktop.evaluate(() => window.scrollTo(0, 0));
  await desktop.waitForTimeout(350);
  await desktop.screenshot({ path: path.join(root, "desktop-dark.png"), fullPage: true });
  console.log(
    "PASS desktop /D:/ entry: login errors and retry, canonical API, calendar, whole-session completion, preserved progress, dark theme",
  );
  const alternateDesktop = await context(false, "/C:/plugin/u12345/bililivereplay");
  await alternateDesktop.context().close();
  contexts.splice(contexts.indexOf(alternateDesktop.context()), 1);
  console.log(
    "PASS desktop /C:/ entry with u-prefixed UID: authenticated login and streamer listing",
  );
  const mobile = await context(true);
  await mobile.getByRole("button", { name: "查看 回放测试主播 的录播日历", exact: true }).click();
  await mobile.getByRole("button", { name: /2026-10-15，2 场录像，1 场已看完/ }).click();
  assert.equal(await mobile.locator(".day-session-row").count(), 2);
  assert(await mobile.locator(".n-drawer").isVisible());
  await mobile.screenshot({ path: path.join(root, "mobile-day.png"), fullPage: true });
  await mobile
    .locator(".day-session-row")
    .filter({ hasText: "回放测试·上午场" })
    .locator(".session-entry")
    .click();
  await mobile.waitForFunction(() => {
    const video = document.querySelector("video");
    return video && !video.paused && video.currentTime >= 7 && video.duration > 100;
  });
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mobile.evaluate(() => {
    window.__video = document.querySelector("video");
  });
  await mobile.locator(".art-control-fullscreen").click();
  await mobile.waitForSelector(".bililivewatch-fullscreen-stage");
  await mobile.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    document.querySelector("video").currentTime = 25;
  });
  await until(async () => (await read(9001)).position >= 25, "save while fullscreen/backgrounded");
  await mobile.screenshot({ path: path.join(root, "mobile-fullscreen.png") });
  await mobile.locator(".bililivewatch-fullscreen-exit").click();
  await mobile.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    const video = document.querySelector("video");
    video.currentTime = 40;
    video.pause();
  });
  await until(async () => (await read(9001)).position >= 40, "pause after fullscreen exit");
  assert.equal(
    await mobile.evaluate(() => document.querySelector("video") === window.__video),
    true,
  );
  await mobile.reload();
  await mobile.waitForFunction(() => {
    const video = document.querySelector("video");
    return video && !video.paused && video.currentTime >= 40 && video.currentTime < 45;
  });
  await mobile.locator(".art-control-fullscreen").click();
  await mobile.waitForSelector(".bililivewatch-fullscreen-stage");
  await mobile.evaluate(() => {
    window.__video = document.querySelector("video");
    document.querySelector("video").currentTime = 119.5;
  });
  await mobile.waitForFunction(
    () =>
      document.body.textContent.includes("第 2 / 3 段") &&
      document.querySelector("video").currentTime < 10 &&
      !document.querySelector("video").paused,
  );
  assert.equal((await read(9001)).completed, true);
  assert.equal(
    await mobile.evaluate(() => document.querySelector("video") === window.__video),
    true,
  );
  assert.equal(await mobile.locator(".bililivewatch-fullscreen-stage").count(), 1);
  await mobile.locator(".bililivewatch-fullscreen-exit").click();
  await mobile.getByRole("button", { name: "返回", exact: true }).click();
  await mobile.getByRole("button", { name: /2026-10-15，2 场录像/ }).click();
  await mobile
    .getByRole("button", { name: "将场次 回放测试·上午场 标记已看", exact: true })
    .click();
  await until(
    async () => (await read(9002)).completed && (await read(9003)).completed,
    "mobile whole-session marking",
  );
  await mobile
    .getByRole("button", { name: /2026-10-15，2 场录像，2 场已看完，全部看完/ })
    .waitFor();
  await mobile.screenshot({ path: path.join(root, "mobile-completed.png"), fullPage: true });
  console.log(
    "PASS mobile: drawer, real fullscreen, background/foreground progress, reload resume, same-video autoplay, whole-session marking",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const database = new Database(path.join(root, "data/app.db"), { readonly: true });
  assert.deepEqual(database.prepare("SELECT * FROM record_history").all(), records);
  assert.deepEqual(database.prepare("SELECT sql FROM sqlite_master ORDER BY name").all(), schema);
  database.close();
  const originLog = fs
    .readFileSync(path.join(root, "docker-origin.log"), "utf8")
    .trim()
    .split("\n");
  assert(
    originLog.every((url) => url.startsWith("/api/") || url === "/index.html"),
    "no Docker frontend assets should be requested",
  );
  const result = {
    status: "passed",
    desktop: true,
    mobileEmulation: true,
    realAndroidDevice: false,
    standaloneFrontend: true,
    realBackend: true,
    realSQLite: true,
    originalDatabaseUnchanged: true,
    checkedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, "result.json"), JSON.stringify(result, null, 2));
  for (const ctx of contexts) await ctx.close();
  console.log(
    "PASS original recording database rows and schema unchanged; screenshots/results:",
    root,
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    for (const proc of children.reverse()) await stop(proc);
  });
