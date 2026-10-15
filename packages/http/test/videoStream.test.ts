import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import Koa from "koa";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { streamVideo } from "../src/services/videoStream.js";

describe("video HTTP streaming and end-of-file ranges", () => {
  let directory: string;
  let server: Server;
  let base: string;
  const small = Buffer.from("FLV fixture bytes end exactly here");
  const large = Buffer.alloc(1024 * 1024 + 127, 42);
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "video-stream-"));
    fs.writeFileSync(path.join(directory, "small"), small);
    fs.writeFileSync(path.join(directory, "large"), large);
    fs.writeFileSync(path.join(directory, "empty"), "");
    const app = new Koa();
    app.use((ctx) => {
      const name = ctx.path === "/large" ? "large" : ctx.path === "/empty" ? "empty" : "small";
      const file = path.join(directory, name);
      streamVideo(ctx, file, fs.statSync(file).size, "video/x-flv");
    });
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it("reports the real length for small FLV files, so readers recognize EOF", async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(small.length));
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("content-type")).toBe("video/x-flv");
    expect(response.headers.get("access-control-expose-headers")).toContain("Content-Range");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(small);
  });
  it("streams the entire file without truncating un-ranged requests at 1MB", async () => {
    const response = await fetch(`${base}/large`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(large.length));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(large);
  });
  it.each([
    ["bytes=2-7", 2, 7],
    ["bytes=3-", 3, small.length - 1],
    ["bytes=-4", small.length - 4, small.length - 1],
    ["bytes=4-999999", 4, small.length - 1],
  ])("handles range %s", async (range, start, end) => {
    const response = await fetch(base, { headers: { Range: String(range) } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end}/${small.length}`);
    expect(response.headers.get("content-length")).toBe(String(Number(end) - Number(start) + 1));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      small.subarray(Number(start), Number(end) + 1),
    );
  });
  it.each([
    `bytes=${small.length}-`,
    `bytes=${small.length + 1}-`,
    "bytes=8-2",
    "bytes=-0",
    "bytes=-",
    "bytes=1-2,4-5",
    "bytes=9007199254740999-",
  ])("returns 416 without opening an invalid stream for %s", async (range) => {
    const response = await fetch(base, { headers: { Range: range } });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${small.length}`);
    await response.arrayBuffer();
  });
  it("handles empty files and rejects ranges on them", async () => {
    const empty = await fetch(`${base}/empty`);
    expect(empty.status).toBe(200);
    expect((await empty.arrayBuffer()).byteLength).toBe(0);
    const range = await fetch(`${base}/empty`, { headers: { Range: "bytes=0-" } });
    expect(range.status).toBe(416);
    expect(range.headers.get("content-range")).toBe("bytes */0");
  });
});
