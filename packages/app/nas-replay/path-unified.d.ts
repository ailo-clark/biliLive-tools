declare module "path-unified" {
  const browserPath: typeof import("node:path");
  export default browserPath;
}
