import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root,
  base: "./",
  define: {
    "import.meta.env.VITE_NAS_REPLAY": JSON.stringify("true"),
    "import.meta.env.VITE_DEFAULT_SERVER": JSON.stringify("/api"),
  },
  resolve: {
    alias: [
      { find: "@renderer/routers", replacement: resolve(root, "router.ts") },
      { find: "@renderer/utils/pages", replacement: resolve(root, "navigation.ts") },
      { find: "@renderer", replacement: resolve(root, "../src/renderer/src") },
      { find: "@types", replacement: resolve(root, "../src/types") },
    ],
  },
  plugins: [
    vue(),
    AutoImport({
      dts: false,
      imports: [
        "vue",
        "pinia",
        { "naive-ui": ["useDialog", "useMessage", "useNotification", "useLoadingBar"] },
      ],
    }),
    Components({ dts: false, resolvers: [NaiveUiResolver()] }),
  ],
  build: { outDir: resolve(root, "../out/nas-replay"), emptyOutDir: true },
});
