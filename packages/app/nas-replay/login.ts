import type { AxiosInstance } from "axios";

export class ReplayLoginError extends Error {}

function responseError(status: number, watching: boolean) {
  if (status === 401) return "登录密钥不正确，请检查 BILILIVE_TOOLS_PASSKEY";
  if (status === 403) return "NAS 拒绝访问插件接口（HTTP 403），请完全退出 NAS 客户端后重新打开";
  if (status === 404)
    return watching
      ? "Docker 缺少观看接口（HTTP 404），请检查 biliLive-tools 版本"
      : "插件接口未找到（HTTP 404），请升级插件并重新打开 NAS 客户端";
  if (status === 502 || status === 503 || status === 504)
    return `无法连接 Docker 录播服务（HTTP ${status}），请检查容器状态及映射端口`;
  return `录播接口访问失败（HTTP ${status}），请升级插件并重新打开 NAS 客户端`;
}

export async function verifyReplayLogin(client: Pick<AxiosInstance, "get">, key: string) {
  for (const endpoint of ["/common/version", "/watch-history/streamers"]) {
    const watching = endpoint === "/watch-history/streamers";
    const response = await client.get(endpoint, {
      headers: { Authorization: key },
      params: watching ? { offset: 0 } : undefined,
      timeout: 10000,
      // Handle login HTTP failures here without changing the shared request
      // interceptor's response-body behavior (needed by progress conflicts).
      validateStatus: () => true,
    });
    if (response.status !== 200)
      throw new ReplayLoginError(responseError(response.status, watching));
    const valid = watching
      ? Array.isArray(response.data?.data) && typeof response.data?.total === "number"
      : typeof response.data === "string" && /^\d+\.\d+\.\d+/.test(response.data);
    if (!valid)
      throw new ReplayLoginError("插件接口返回了非预期内容，请升级插件并重新打开 NAS 客户端");
  }
}
