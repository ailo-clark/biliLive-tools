export function useMobileView() {
  if (window.api) return false;
  const preference = window.localStorage.getItem("view-mode");
  return preference === "mobile" || (preference !== "desktop" && window.innerWidth <= 628);
}

export function preferredHome() {
  return useMobileView() ? "/mobile" : "/home";
}
