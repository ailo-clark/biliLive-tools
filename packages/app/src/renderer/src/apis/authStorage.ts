// Keep a NAS plugin's login separate from other applications on the same NAS origin.
const keyName = import.meta.env.VITE_NAS_REPLAY === "true" ? "nas-replay:key" : "key";

export const getAuthKey = () => window.localStorage.getItem(keyName) || "";
export const setAuthKey = (value: string) => window.localStorage.setItem(keyName, value);
export const clearAuthKey = () => window.localStorage.removeItem(keyName);

export function nasApiBase(pathname = window.location.pathname) {
  // The Xiaomi desktop client can prepend a Windows drive/cache directory,
  // e.g. /D:/plugin/<uid>/bililivereplay/index.html. API requests must still
  // target the canonical NAS plugin route rather than the NAS's own /api.
  const match = pathname.match(/\/plugin\/(u?[1-9]\d*)\/bililivereplay(?:\/|$)/);
  return match ? `/plugin/${match[1]}/bililivereplay/api` : "/api";
}
