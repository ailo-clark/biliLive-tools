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
  sessionRecords,
} from "../services/watchHistory.js";
import {
  recordSessionKey,
  sessionKeySQL,
  summarizeSessionWatch,
} from "@biliLive-tools/shared/db/recordSession.js";
import { recordWatchKey } from "@biliLive-tools/shared/db/watchHistory.js";
import { refreshStreamerAvatar } from "../services/watchAvatars.js";
import type { LiveHistory } from "@biliLive-tools/shared/db/model/recordHistory.js";
import {
  streamerLibrary,
  streamerCalendar,
  sessionDescription,
  describeSession,
  libraryStreamer,
} from "../services/watchLibrary.js";

const router = new Router({ prefix: "/watch-history" });
const keySchema = z.string().regex(/^(record|file):[a-f0-9]{64}$/);
const updateSchema = z.object({
  revision: z.number().int().nonnegative(),
  action: z.enum(["progress", "completed", "unwatched", "restart"]),
  position: z.number().finite().nonnegative().optional(),
  duration: z.number().finite().nonnegative().optional(),
});

router.get("/streamers", (ctx) => {
  const query = z
    .object({
      search: z.string().max(200).default(""),
      offset: z.coerce.number().int().nonnegative().default(0),
      limit: z.coerce.number().int().min(1).max(100).default(24),
      includeHidden: z.enum(["true", "false"]).default("false"),
    })
    .safeParse(ctx.query);
  if (!query.success) {
    ctx.throw(400, "无效的查询参数");
    return;
  }
  ctx.body = streamerLibrary(
    query.data.search,
    query.data.offset,
    query.data.limit,
    query.data.includeHidden === "true",
  );
});

router.get("/streamers/:streamerId/avatar", async (ctx) => {
  const id = z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .safeParse(ctx.params.streamerId);
  if (!id.success) {
    ctx.throw(400, "无效的主播标识");
    return;
  }
  const profile = libraryStreamer(id.data);
  if (!profile) {
    ctx.throw(404, "主播不存在");
    return;
  }
  ctx.body = { avatar: await refreshStreamerAvatar(profile) };
});

router.put("/streamers/:streamerId/visibility", (ctx) => {
  const parsed = z
    .object({
      streamerId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      hidden: z.boolean(),
    })
    .safeParse({ ...(ctx.request.body as object), streamerId: ctx.params.streamerId });
  if (!parsed.success) {
    ctx.throw(400, "无效的主播或显示设置");
    return;
  }
  if (!libraryStreamer(parsed.data.streamerId)) {
    ctx.throw(404, "主播不存在");
    return;
  }
  watchHistoryStore.setStreamerHidden(parsed.data.streamerId, parsed.data.hidden);
  ctx.body = { streamerId: parsed.data.streamerId, hidden: parsed.data.hidden };
});

router.get("/calendar/:streamerId", (ctx) => {
  const query = z
    .object({
      streamerId: z.coerce.number().int().positive(),
      month: z
        .string()
        .regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/)
        .optional(),
      timeZone: z.string().max(100).optional(),
    })
    .safeParse({ ...ctx.query, streamerId: ctx.params.streamerId });
  if (!query.success) {
    ctx.throw(400, "无效的月份或主播标识");
    return;
  }
  try {
    const result = streamerCalendar(query.data.streamerId, query.data.month, query.data.timeZone);
    if (!result) {
      ctx.throw(404, "主播不存在");
      return;
    }
    ctx.body = result;
  } catch (error) {
    if (error instanceof RangeError) {
      ctx.throw(400, "无效的时区");
      return;
    }
    throw error;
  }
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
  const hidden = new Set(watchHistoryStore.hiddenStreamerIds());
  if (!hidden.size) {
    ctx.body = watchHistoryStore.recent(query.data.limit, query.data.offset, query.data.status);
    return;
  }
  const lookup = getMainDb().prepare("SELECT streamer_id FROM record_history WHERE id = ?");
  const visible: ReturnType<typeof watchHistoryStore.recent> = [];
  let rawOffset = 0;
  let matched = 0;
  while (visible.length < query.data.limit) {
    const batch = watchHistoryStore.recent(100, rawOffset, query.data.status);
    if (!batch.length) break;
    rawOffset += batch.length;
    for (const state of batch) {
      const record = state.recordId
        ? (lookup.get(state.recordId) as { streamer_id: number } | undefined)
        : undefined;
      if (record && hidden.has(record.streamer_id)) continue;
      if (matched++ < query.data.offset) continue;
      visible.push(state);
      if (visible.length === query.data.limit) break;
    }
  }
  ctx.body = visible;
});

// Paginate complete sessions, then filter their aggregate state. A matching title
// selects the entire stream, including clips whose titles differ.
router.get("/sessions", async (ctx) => {
  const query = z
    .object({
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.enum(["all", "unwatched", "watching", "completed"]).default("all"),
      search: z.string().max(200).default(""),
      streamerId: z.coerce.number().int().positive().optional(),
      recent: z.enum(["true", "false"]).default("false"),
      offset: z.coerce.number().int().nonnegative().default(0),
    })
    .safeParse(ctx.query);
  if (!query.success) {
    ctx.throw(400, "无效的查询参数");
    return;
  }
  const { limit, status, search, recent, offset } = query.data;
  const hidden = new Set(watchHistoryStore.hiddenStreamerIds());
  let cursor = query.data.before ?? Number.MAX_SAFE_INTEGER;
  const data: any[] = [];
  let exhausted = false;
  const candidateSQL = `SELECT r.streamer_id AS streamerId, ${sessionKeySQL} AS sessionKey,
    max(r.id) AS cursor, s.name AS streamerName, s.room_id AS roomId, s.platform
    FROM record_history r JOIN streamer s ON r.streamer_id = s.id
    WHERE coalesce(r.video_file, '') != '' AND (? IS NULL OR r.streamer_id = ?)
    GROUP BY r.streamer_id, ${sessionKeySQL}
    HAVING max(r.id) < ? AND (? = '' OR max(instr(lower(coalesce(r.title, '') || ' ' ||
      coalesce(s.name, '') || ' ' || s.room_id), lower(?))) > 0)
    ORDER BY max(r.id) DESC LIMIT 100`;
  const build = async (candidate: any) => ({
    ...candidate,
    ...describeSession(
      {
        id: candidate.streamerId,
        name: candidate.streamerName,
        roomId: candidate.roomId,
        platform: candidate.platform,
        avatar: null,
      },
      sessionRecords(candidate.streamerId, candidate.sessionKey),
    ),
  });
  if (recent === "true") {
    const candidates = new Map<string, any>();
    const lookup = getMainDb().prepare(`SELECT r.*, s.name AS streamerName, s.room_id AS roomId,
      s.platform FROM record_history r JOIN streamer s ON r.streamer_id = s.id WHERE r.id = ?`);
    for (const played of watchHistoryStore.playedRecords()) {
      const record = lookup.get(played.recordId) as any;
      if (!record || recordWatchKey(record) !== played.key || !record.video_file) continue;
      if (hidden.has(record.streamer_id) && !query.data.streamerId) continue;
      if (query.data.streamerId && record.streamer_id !== query.data.streamerId) continue;
      const sessionKey = recordSessionKey(record);
      const key = `${record.streamer_id}:${sessionKey}`;
      if (!candidates.has(key))
        candidates.set(key, {
          streamerId: record.streamer_id,
          sessionKey,
          streamerName: record.streamerName,
          roomId: record.roomId,
          platform: record.platform,
        });
    }
    let matched = 0;
    for (const candidate of candidates.values()) {
      const session = await build(candidate);
      if (status !== "all" && status !== session.watch.status) continue;
      if (
        search &&
        !`${session.title} ${session.streamerName} ${session.roomId}`
          .toLowerCase()
          .includes(search.toLowerCase())
      )
        continue;
      if (matched++ < offset) continue;
      if (data.length === limit) break;
      data.push(session);
    }
    ctx.body = { data, nextCursor: matched > offset + data.length ? offset + data.length : null };
    return;
  }
  while (data.length < limit && !exhausted) {
    const candidates = getMainDb()
      .prepare(candidateSQL)
      .all(
        query.data.streamerId ?? null,
        query.data.streamerId ?? null,
        cursor,
        search,
        search,
      ) as any[];
    if (!candidates.length) {
      exhausted = true;
      break;
    }
    for (const candidate of candidates) {
      cursor = candidate.cursor;
      if (hidden.has(candidate.streamerId) && !query.data.streamerId) continue;
      const session = await build(candidate);
      if (status === "all" || session.watch.status === status) data.push(session);
      if (data.length === limit) break;
    }
  }
  ctx.body = { data, nextCursor: exhausted ? null : cursor };
});

router.post("/session-clips", async (ctx) => {
  const parsed = z
    .object({ streamerId: z.number().int().positive(), sessionKey: z.string().min(1).max(500) })
    .safeParse(ctx.request.body);
  if (!parsed.success) {
    ctx.throw(400, "无效的场次标识");
    return;
  }
  const records = sessionRecords(parsed.data.streamerId, parsed.data.sessionKey);
  if (!records.length) {
    ctx.throw(404, "场次不存在");
    return;
  }
  const data = await Promise.all(
    records.map(async (record) => ({ ...record, watch: await recordWatchState(record) })),
  );
  ctx.body = {
    data,
    watch: summarizeSessionWatch(data.map((record) => record.watch)),
    session: sessionDescription(parsed.data.streamerId, parsed.data.sessionKey),
  };
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
  const hidden = new Set(watchHistoryStore.hiddenStreamerIds());
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
      if (hidden.has(record.streamer_id)) continue;
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
