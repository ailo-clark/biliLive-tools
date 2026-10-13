import router from "@renderer/routers";
import { recordHistoryApi, recoderApi, commonApi } from "@renderer/apis";
import watchApi from "@renderer/apis/watchHistory";
import { useMobileView } from "@renderer/utils/viewMode";

export async function toVideoPlayerPage(opts: {
  videoFilePath: string;
  danmaId?: string | null;
  recordId?: number;
}): Promise<void>;
export async function toVideoPlayerPage(opts: {
  videoFilePath?: string;
  danmaId?: string | null;
  videoId: string;
  videoType: string;
  recordId?: number;
}): Promise<void>;
export async function toVideoPlayerPage(opts: {
  videoFilePath?: string;
  danmaId?: string | null;
  videoId?: string;
  videoType?: string;
  recordId?: number;
}) {
  if (!opts.videoFilePath && !opts.videoId) {
    throw new Error("缺少视频文件路径或视频ID");
  }
  // 如果 videoId 存在但 videoType 不存在，报错
  if (opts.videoId && opts.videoType === undefined) {
    throw new Error("存在videoId时必选视频类型");
  }
  let videoId = opts.videoId;
  let videoType = opts.videoType;
  let danmaId = opts.danmaId;

  // 如果没有 videoId，但有 videoFilePath，则调用接口申请 videoId
  if (!videoId && opts.videoFilePath) {
    const data = await commonApi.applyVideoId(opts.videoFilePath);
    videoId = data.videoId;
    videoType = data.type;
  }

  if (!danmaId && opts.videoFilePath) {
    const data = await recordHistoryApi.getDanmaFileInfo(opts.videoFilePath);
    danmaId = data.danmaFileId || undefined;
  }

  if (videoId && videoType !== undefined) {
    if (videoType === "ts") {
      throw new Error("ts文件暂不支持播放");
    }

    const query: Record<string, string> = {
      videoId,
      type: videoType,
    };
    if (danmaId) {
      query.danmaId = danmaId;
    }
    if (opts.recordId) query.recordId = String(opts.recordId);

    if (window.isWeb) {
      if (useMobileView()) {
        await router.push({ name: "MobilePlayer", query });
        return;
      }
      const url = router.resolve({
        name: "VideoPlayer",
        query,
      }).href;
      window.open(url, "_blank");
    } else {
      window.api.common.createSubWindow({
        routeName: "videoPlayer",
        hideAside: true,
        hideMenuBar: true,
        query,
      });
    }
  } else {
    throw new Error("无法播放");
  }
}

export async function playRecord(recordId: number) {
  const { videoFileId, videoFileExt, danmaFileId } = await recordHistoryApi.getFileInfo(recordId);
  return toVideoPlayerPage({
    videoId: videoFileId,
    videoType: videoFileExt,
    danmaId: danmaFileId,
    recordId,
  });
}

export async function playWatch(key: string) {
  const source = await watchApi.play(key);
  return toVideoPlayerPage({ videoFilePath: source.filePath, recordId: source.recordId });
}

export async function toLiveVideoPlayerPage(opts: { liveId: string; owner: string }) {
  const data = await recoderApi.getStreamUrl(opts.liveId);
  if (!data.url) {
    throw new Error("无法获取可供播放的流");
  }
  const query: Record<string, string> = {
    liveId: opts.liveId,
    url: data.url,
    owner: opts.owner,
  };

  if (window.isWeb) {
    const url = router.resolve({
      name: "LiveVideoPlayer",
      query,
    }).href;
    window.open(url, "_blank");
  } else {
    window.api.common.createSubWindow({
      routeName: "liveVideoPlayer",
      hideAside: true,
      hideMenuBar: true,
      query,
    });
  }
}
