<template>
  <n-drawer
    v-if="mobile"
    :show="show"
    placement="bottom"
    height="80vh"
    @update:show="$emit('update:show', $event)"
  >
    <n-drawer-content :title="title" closable>
      <n-alert v-if="error" type="error">{{ error }}</n-alert>
      <div class="day-sessions">
        <div v-for="session in sessions" :key="session.key" class="day-session-row">
          <WatchSessionEntry :session="session" :time-zone="timeZone" @play="play(session)" />
          <n-tooltip
            ><template #trigger
              ><n-button
                quaternary
                circle
                class="session-mark"
                :aria-label="`将场次 ${session.title || '未命名场次'} 标记已看`"
                :disabled="session.watch.completed || !!marking"
                :loading="marking === session.key"
                @click="mark(session)"
                ><n-icon :size="24"
                  ><CheckmarkCircle v-if="session.watch.completed" /><CheckmarkCircleOutline
                    v-else /></n-icon></n-button></template
            >{{
              session.watch.completed ? "整场已看完" : "将整场标记已看（保留播放进度）"
            }}</n-tooltip
          >
        </div>
      </div>
      <n-empty v-if="!sessions.length" description="该日期无录制记录" />
    </n-drawer-content>
  </n-drawer>
  <n-modal
    v-else
    :show="show"
    preset="card"
    :title="title"
    style="width: min(640px, 90vw); max-height: 80vh; overflow: auto"
    @update:show="$emit('update:show', $event)"
  >
    <n-alert v-if="error" type="error">{{ error }}</n-alert>
    <div class="day-sessions">
      <div v-for="session in sessions" :key="session.key" class="day-session-row">
        <WatchSessionEntry :session="session" :time-zone="timeZone" @play="play(session)" />
        <n-tooltip
          ><template #trigger
            ><n-button
              quaternary
              circle
              class="session-mark"
              :aria-label="`将场次 ${session.title || '未命名场次'} 标记已看`"
              :disabled="session.watch.completed || !!marking"
              :loading="marking === session.key"
              @click="mark(session)"
              ><n-icon :size="24"
                ><CheckmarkCircle v-if="session.watch.completed" /><CheckmarkCircleOutline
                  v-else /></n-icon></n-button></template
          >{{
            session.watch.completed ? "整场已看完" : "将整场标记已看（保留播放进度）"
          }}</n-tooltip
        >
      </div>
    </div>
    <n-empty v-if="!sessions.length" description="该日期无录制记录" />
  </n-modal>
</template>
<script setup lang="ts">
import { useMediaQuery } from "@vueuse/core";
import { CheckmarkCircle, CheckmarkCircleOutline } from "@vicons/ionicons5";
import { markSessionCompleted } from "@renderer/utils/markSession";
import WatchSessionEntry from "./WatchSessionEntry.vue";
import type { WatchSession } from "@renderer/apis/watchHistory";
import { playSession } from "@renderer/utils/pages";
const props = defineProps<{
  show: boolean;
  date: string;
  sessions: WatchSession[];
  timeZone: string;
}>();
const emit = defineEmits<{
  (event: "update:show", value: boolean): void;
  (event: "changed"): void;
}>();
const mobile = useMediaQuery("(max-width: 628px)");
const title = computed(() => `${props.date} · ${props.sessions.length} 场录像`);
const error = ref("");
const marking = ref("");
async function mark(session: WatchSession) {
  if (marking.value || session.watch.completed) return;
  marking.value = session.key;
  error.value = "";
  try {
    await markSessionCompleted(session);
  } catch (e: any) {
    error.value = String(e?.message || e || "标记失败，请刷新后重试");
  } finally {
    marking.value = "";
    emit("changed");
    window.dispatchEvent(new Event("watch-history-updated"));
  }
}
watch(
  () => props.show,
  () => {
    error.value = "";
  },
);
async function play(session: WatchSession) {
  try {
    await playSession(session);
    emit("update:show", false);
  } catch (e: any) {
    error.value = String(e?.message || e);
  }
}
</script>
<style scoped>
.day-sessions {
  display: grid;
  gap: 12px;
  padding-bottom: env(safe-area-inset-bottom);
}
.day-session-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.day-session-row :deep(.session-entry) {
  flex: 1;
  min-width: 0;
}
.session-mark {
  min-width: 44px;
  min-height: 44px;
  color: var(--watch-primary);
}
</style>
