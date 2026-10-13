import Router from "@koa/router";
import fs from "fs-extra";
import { z } from "zod";
import { fileCache } from "../index.js";
import {
  getMainDb,
  recordHistoryService,
  watchHistoryStore,
} from "@biliLive-tools/shared/db/index.js";
import {
  recordWatchState,
  resolveFileWatch,
  resolveRecordWatch,
} from "../services/watchHistory.js";
import type { LiveHistory } from "@biliLive-tools/shared/db/model/recordHistory.js";

const router = new Router({ prefix: "/watch-history" });
const keySchema = z.string().regex(/^(record|file):[a-f0-9]{64}$/);
const updateSchema = z.object({
  revision: z.number().int().nonnegative(),
  action: z.enum(["progress", "completed", "unwatched", "restart"]),
  position: z.number().finite().nonnegative().optional(),
  duration: z.number().finite().nonnegative().optional(),
});

router.post("/resolve", async (ctx) => {
  const parsed = z
    .object({ recordId: z.number().int().positive().optional(), videoId: z.string().optional() })
    .refine((value) => Boolean(value.recordId || value.videoId))
    .safeParse(ctx.request.body);
  if (!parsed.success) {
    ctx.throw(400, "缺少有效的录像标识");
    return;
  }
  const { recordId, videoId } = parsed.data;
  if (recordId) {
    const record = recordHistoryService.query({ id: recordId });
    if (!record) {
      ctx.throw(404, "录像不存在");
      return;
    }
    ctx.body = await resolveRecordWatch(record);
  } else {
    const file = fileCache.get(videoId!);
    if (!file || file.expireAt < Date.now()) {
      ctx.throw(404, "播放凭据已过期，请重新打开录像");
      return;
    }
    ctx.body = await resolveFileWatch(file.path);
  }
});

router.get("/recent", async (ctx) => {
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      offset: z.coerce.number().int().nonnegative().default(0),
      status: z.enum(["all", "watching", "completed"]).default("all"),
    })
    .safeParse(ctx.query);
  if (!query.success) {
    ctx.throw(400, "无效的查询参数");
    return;
  }
  ctx.body = watchHistoryStore.recent(query.data.limit, query.data.offset, query.data.status);
});

// Read existing recording history. Filtering never adds columns/tables to app.db.
router.get("/library", async (ctx) => {
  const query = z
    .object({
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.enum(["all", "unwatched", "watching", "completed"]).default("all"),
      search: z.string().max(200).default(""),
    })
    .safeParse(ctx.query);
  if (!query.success) {
    ctx.throw(400, "无效的查询参数");
    return;
  }
  const { limit, status, search } = query.data;
  let cursor = query.data.before ?? Number.MAX_SAFE_INTEGER;
  const items: any[] = [];
  let exhausted = false;
  while (items.length < limit && !exhausted) {
    const records = getMainDb()
      .prepare(
        `SELECT r.*, s.name AS streamer_name, s.platform, s.room_id
      FROM record_history r JOIN streamer s ON r.streamer_id = s.id
      WHERE r.id < ? AND r.video_file IS NOT NULL
      AND (? = '' OR instr(lower(coalesce(r.title, '') || ' ' || coalesce(s.name, '') || ' ' || s.room_id), lower(?)) > 0)
      ORDER BY r.id DESC LIMIT 100`,
      )
      .all(cursor, search, search) as LiveHistory[];
    if (records.length === 0) {
      exhausted = true;
      break;
    }
    for (const record of records) {
      cursor = record.id;
      const watch = await recordWatchState(record);
      const state = watch?.completed ? "completed" : watch?.lastPlayedAt ? "watching" : "unwatched";
      if (status === "all" || status === state) items.push({ ...record, watch });
      if (items.length === limit) break;
    }
  }
  ctx.body = { data: items, nextCursor: exhausted ? null : cursor };
});

router.get("/:key/play", async (ctx) => {
  const key = keySchema.safeParse(ctx.params.key);
  if (!key.success) {
    ctx.throw(400, "无效的观看标识");
    return;
  }
  let watch = watchHistoryStore.get(key.data);
  if (!watch) {
    ctx.throw(404, "观看记录不存在");
    return;
  }
  if (watch.recordId) {
    const record = recordHistoryService.query({ id: watch.recordId });
    if (!record || (await recordWatchState(record))?.key !== watch.key) {
      ctx.throw(404, "原录像已删除或被替换");
      return;
    }
    watch = await resolveRecordWatch(record);
  } else {
    try {
      const current = await resolveFileWatch(watch.filePath);
      if (current.key !== watch.key) {
        ctx.throw(404, "原视频已被替换");
        return;
      }
    } catch {
      ctx.throw(404, "视频不存在或已被替换");
      return;
    }
  }
  if (!watch.filePath || !(await fs.pathExists(watch.filePath))) {
    ctx.throw(404, "视频文件不存在");
    return;
  }
  ctx.body = {
    videoId: fileCache.setFile(watch.filePath),
    filePath: watch.filePath,
    recordId: watch.recordId,
  };
});

router.get("/:key", (ctx) => {
  const key = keySchema.safeParse(ctx.params.key);
  if (!key.success) {
    ctx.throw(400, "无效的观看标识");
    return;
  }
  const state = watchHistoryStore.get(key.data);
  if (!state) {
    ctx.throw(404, "观看记录不存在");
    return;
  }
  ctx.body = state;
});

router.put("/:key", (ctx) => {
  const key = keySchema.safeParse(ctx.params.key);
  const update = updateSchema.safeParse(ctx.request.body);
  if (!key.success || !update.success) {
    ctx.throw(400, "无效的观看进度");
    return;
  }
  const result = watchHistoryStore.update(key.data, update.data);
  if (!result.state) {
    ctx.throw(404, "观看记录不存在");
    return;
  }
  ctx.status = result.conflict ? 409 : 200;
  ctx.body = result.state;
});

export default router;
