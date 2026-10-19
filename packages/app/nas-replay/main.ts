import { createApp } from "vue";
import { createPinia } from "pinia";
import browserPath from "path-unified";
import App from "./App.vue";
import router from "./router";
import { init } from "@renderer/apis/request";
import "./fullscreen.js";

window.isWeb = true;
window.isFullstack = true;
window.path = browserPath;
await init();
createApp(App).use(createPinia()).use(router).mount("#app");
