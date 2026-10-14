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
        <WatchSessionEntry
          v-for="session in sessions"
          :key="session.key"
          :session="session"
          :time-zone="timeZone"
          @play="play(session)"
        />
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
      <WatchSessionEntry
        v-for="session in sessions"
        :key="session.key"
        :session="session"
        :time-zone="timeZone"
        @play="play(session)"
      />
    </div>
    <n-empty v-if="!sessions.length" description="该日期无录制记录" />
  </n-modal>
</template>
<script setup lang="ts">
import { useMediaQuery } from "@vueuse/core";
import WatchSessionEntry from "./WatchSessionEntry.vue";
import type { WatchSession } from "@renderer/apis/watchHistory";
import { playSession } from "@renderer/utils/pages";
const props = defineProps<{
  show: boolean;
  date: string;
  sessions: WatchSession[];
  timeZone: string;
}>();
const emit = defineEmits<{ (event: "update:show", value: boolean): void }>();
const mobile = useMediaQuery("(max-width: 628px)");
const title = computed(() => `${props.date} · ${props.sessions.length} 场录像`);
const error = ref("");
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
</style>
