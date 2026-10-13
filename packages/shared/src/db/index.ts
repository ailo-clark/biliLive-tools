import { setupContainer } from "./container.js";
import { WatchHistoryStore } from "./watchHistory.js";

import type { Database as DatabaseType } from "better-sqlite3";
import type { Container } from "./container.js";

export let dbContainer: ReturnType<typeof setupContainer>;
export let statisticsService: Container["statisticsService"];
export let virtualRecordService: Container["virtualRecordService"];
export let videoSubDataService: Container["videoSubDataService"];
export let streamerService: Container["streamerService"];
export let videoSubService: Container["videoSubService"];
export let recordHistoryService: Container["recordHistoryService"];
export let uploadPartService: Container["uploadPartService"];
export let danmuService: Container["danmuService"];
export let subtitleStyleService: Container["subtitleStyleService"];
export let watchHistoryStore: WatchHistoryStore;

export const initDB = (dbRootPath: string): void => {
  // 依赖注入容器
  dbContainer = setupContainer(dbRootPath);
  setExportServices(dbContainer);
  watchHistoryStore = new WatchHistoryStore(dbRootPath);
  // Construct an SQLite iterator only when it will be consumed. Even an unused
  // iterator keeps its connection busy and prevents subsequent startup writes.
  if (!watchHistoryStore.metadata("existing-records-initialized")) {
    watchHistoryStore.initializeExistingRecords(
      getMainDb().prepare("SELECT * FROM record_history ORDER BY id").iterate() as Iterable<
        import("./model/recordHistory.js").LiveHistory
      >,
    );
  }
};

export const closeDB = (): void => {
  const mainDb = dbContainer.resolve("db");
  const danmuDb = dbContainer.resolve("danmuDb");
  if (mainDb) mainDb.close();
  if (danmuDb) danmuDb.close();
  watchHistoryStore?.close();
};

export const backupDB = (filename: string) => {
  const mainDb = dbContainer.resolve("db");
  if (mainDb) return mainDb.backup(filename);
  return;
};

export const backupWatchDB = (filename: string) => watchHistoryStore.backup(filename);

export const reconnectDB = (): void => {
  const dbRootPath = dbContainer.resolve("dbRootPath");
  initDB(dbRootPath);
};

const setExportServices = (dbContainer: ReturnType<typeof setupContainer>) => {
  statisticsService = dbContainer.resolve("statisticsService");
  virtualRecordService = dbContainer.resolve("virtualRecordService");
  videoSubDataService = dbContainer.resolve("videoSubDataService");
  streamerService = dbContainer.resolve("streamerService");
  videoSubService = dbContainer.resolve("videoSubService");
  recordHistoryService = dbContainer.resolve("recordHistoryService");
  uploadPartService = dbContainer.resolve("uploadPartService");
  danmuService = dbContainer.resolve("danmuService");
  subtitleStyleService = dbContainer.resolve("subtitleStyleService");
};

export const getMainDb = (): DatabaseType => dbContainer.resolve("db");
export const getDanmuDb = (): DatabaseType => dbContainer.resolve("danmuDb");
