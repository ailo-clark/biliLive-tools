// Keep a NAS plugin's login separate from other applications on the same NAS origin.
const keyName = import.meta.env.VITE_NAS_REPLAY === "true" ? "nas-replay:key" : "key";

export const getAuthKey = () => window.localStorage.getItem(keyName) || "";
export const setAuthKey = (value: string) => window.localStorage.setItem(keyName, value);
export const clearAuthKey = () => window.localStorage.removeItem(keyName);

export function nasApiBase(pathname = window.location.pathname) {
  const match = pathname.match(/^\/plugin\/(u?[1-9]\d*)\/bililivereplay(?:\/|$)/);
  return match ? `/plugin/${match[1]}/bililivereplay/api` : "/api";
}
