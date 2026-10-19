import axios from "axios";
import router from "@renderer/routers";
import { getAuthKey, clearAuthKey, nasApiBase } from "./authStorage";

const api = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
});

if (import.meta.hot) {
  window.isWeb = !window.api;
  init();
}

export async function init() {
  if (import.meta.env.VITE_NAS_REPLAY === "true") {
    api.defaults.baseURL = nasApiBase();
    return;
  }
  if (window.isWeb) {
    const baseURL = window.localStorage.getItem("api");
    if (baseURL) {
      api.defaults.baseURL = baseURL;
    } else {
      if (!import.meta.env.VITE_DEFAULT_SERVER) {
        api.defaults.baseURL = `http://127.0.0.1:18010`;
      }
    }
  } else {
    const appConfig = await window.api.config.getAll();
    const protocol = appConfig.https ? "https" : "http";
    api.defaults.baseURL = `${protocol}://127.0.0.1:${appConfig.port}`;
    api.defaults.headers.Authorization = appConfig.passKey;
  }
}

api.interceptors.request.use(
  (config) => {
    // header authorization
    const keyStorage = getAuthKey();
    if (keyStorage) {
      config.headers.Authorization = keyStorage;
    }
    const baseURL =
      import.meta.env.VITE_NAS_REPLAY === "true"
        ? nasApiBase()
        : window.localStorage.getItem("api");
    if (baseURL) {
      config.baseURL = baseURL;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

api.interceptors.response.use(
  (response) => {
    return Promise.resolve(response);
  },
  (error) => {
    const route = router.currentRoute.value;
    if (error?.response?.status === 401 && route.name !== "Login") {
      clearAuthKey();
      router.push("/login");
    }
    return Promise.reject(error?.response?.data ?? error?.response?.status);
  },
);

export default api;
