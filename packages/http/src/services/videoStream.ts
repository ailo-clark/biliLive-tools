import fs from "node:fs";
import type { Context } from "koa";

/** Stream completed/growing files with accurate HTTP lengths and single-byte ranges. */
export function streamVideo(ctx: Context, filename: string, size: number, contentType: string) {
  ctx.set("Accept-Ranges", "bytes");
  ctx.set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
  ctx.set("Content-Type", contentType);
  const range = ctx.get("Range");
  if (!range) {
    ctx.status = 200;
    ctx.length = size;
    ctx.body = size ? fs.createReadStream(filename, { start: 0, end: size - 1 }) : Buffer.alloc(0);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = 0;
  let end = size - 1;
  let valid = Boolean(match && (match[1] || match[2]) && size > 0);
  if (match && valid) {
    if (!match[1]) {
      const suffix = Number(match[2]);
      valid = Number.isSafeInteger(suffix) && suffix > 0;
      start = Math.max(0, size - suffix);
    } else {
      start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : end;
      valid =
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(requestedEnd) &&
        start < size &&
        requestedEnd >= start;
      end = Math.min(requestedEnd, end);
    }
  }
  if (!valid) {
    ctx.status = 416;
    ctx.set("Content-Range", `bytes */${size}`);
    return;
  }
  ctx.status = 206;
  ctx.set("Content-Range", `bytes ${start}-${end}/${size}`);
  ctx.length = end - start + 1;
  ctx.body = fs.createReadStream(filename, { start, end });
}
