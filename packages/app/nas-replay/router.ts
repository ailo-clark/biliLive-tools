import { createRouter, createWebHashHistory } from "vue-router";
import { getAuthKey } from "@renderer/apis/authStorage";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/login", name: "Login", component: () => import("./Login.vue") },
    { path: "/", redirect: "/mobile" },
    {
      path: "/mobile",
      name: "ReplayHome",
      component: () => import("@renderer/pages/Mobile/Home.vue"),
    },
    {
      path: "/mobile/streamer/:streamerId",
      name: "MobileStreamerCalendar",
      component: () => import("@renderer/pages/Mobile/Streamer.vue"),
    },
    {
      path: "/mobile/session",
      name: "MobileSessionPlayer",
      component: () => import("@renderer/pages/SessionPlayer/index.vue"),
    },
    {
      path: "/mobile/player",
      name: "MobilePlayer",
      component: () => import("@renderer/pages/VideoPlayer/index.vue"),
    },
    { path: "/:pathMatch(.*)*", redirect: "/mobile" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
router.beforeEach((to) => {
  if (to.name !== "Login" && !getAuthKey())
    return { name: "Login", query: { redirect: to.fullPath } };
  return true;
});
export default router;
