<template>
  <div class="streamer-calendar-page">
    <div v-if="data" class="profile">
      <WatchStreamerAvatar :streamer="data.streamer" :size="64" />
      <div>
        <h1>{{ data.streamer.name }}</h1>
        <p>{{ data.streamer.platform }} · {{ data.streamer.roomId }}</p>
      </div>
    </div>
    <div class="view-tools">
      <n-radio-group v-model:value="mode" size="small"
        ><n-radio-button value="calendar">日历</n-radio-button
        ><n-radio-button value="list">场次列表</n-radio-button></n-radio-group
      ><n-button :loading="loading" @click="refresh">刷新</n-button>
    </div>
    <n-alert v-if="error" type="error">{{ error }}</n-alert>
    <n-spin :show="loading">
      <template v-if="data && mode === 'calendar'">
        <section class="calendar-shell">
          <div class="month-tools">
            <n-button
              quaternary
              circle
              aria-label="上个月"
              @click="load(shiftMonth(data.month, -1))"
              ><n-icon><ChevronBackOutline /></n-icon></n-button
            ><n-select
              :value="data.month"
              :options="monthOptions"
              aria-label="选择录制月份"
              class="month-select"
              @update:value="load"
            /><n-button
              quaternary
              circle
              aria-label="下个月"
              @click="load(shiftMonth(data.month, 1))"
              ><n-icon><ChevronForwardOutline /></n-icon></n-button
            ><n-button size="small" @click="load(data.today.slice(0, 7))">今天</n-button>
          </div>
          <div class="weekdays" aria-hidden="true">
            <span v-for="day in ['一', '二', '三', '四', '五', '六', '日']" :key="day">{{
              day
            }}</span>
          </div>
          <div class="month-grid" aria-label="录播月历">
            <button
              v-for="cell in cells"
              :key="cell.date"
              type="button"
              class="calendar-day"
              :class="[
                days.get(cell.date)?.status,
                {
                  outside: !cell.current,
                  today: cell.date === data.today,
                  selected: cell.date === selectedDate,
                },
              ]"
              :disabled="!cell.current"
              :aria-label="dayLabel(cell.date)"
              :title="dayLabel(cell.date)"
              @click="selectDate(cell.date)"
            >
              <span class="day-number">{{ cell.day }}</span>
              <template v-if="cell.current && days.has(cell.date)"
                ><span class="day-icon"
                  ><n-icon v-if="days.get(cell.date)?.status === 'completed'" :size="18"
                    ><CheckmarkCircleOutline /></n-icon
                  ><span
                    v-else-if="days.get(cell.date)?.status === 'watching'"
                    class="progress-ring"
                    :style="{ background: ring(cell.date) }"
                    aria-hidden="true"
                  ></span
                  ><span v-else class="unwatched-dot"></span></span
                ><span class="day-count">{{ days.get(cell.date)?.sessionCount }} 场</span></template
              >
            </button>
          </div>
          <div class="legend">
            <span><i class="unwatched-dot"></i>未观看</span
            ><span><i class="legend-progress"></i>观看中</span
            ><span
              ><n-icon><CheckmarkCircleOutline /></n-icon>全部看完</span
            ><span><i class="legend-empty"></i>无录制记录</span>
          </div>
        </section>
        <p class="calendar-note">时间按 {{ data.timeZone }} 展示 · 跨日场次归到开播日</p>
        <n-empty v-if="!data.sessions.length" description="本月暂无录制记录，可切换有录像的月份" />
      </template>
      <template v-else-if="mode === 'list'">
        <div class="session-list">
          <WatchSessionEntry
            v-for="session in list"
            :key="session.key"
            :session="session"
            :time-zone="data?.timeZone"
            @play="play(session)"
          />
        </div>
        <n-empty v-if="!loading && !list.length" description="暂无录制场次" />
        <n-button v-if="cursor !== null" block :loading="loading" @click="more"
          >加载更多场次</n-button
        >
      </template>
    </n-spin>
    <WatchDayDialog
      v-if="data"
      v-model:show="showDay"
      :date="selectedDate"
      :sessions="selectedSessions"
      :time-zone="data.timeZone"
    />
  </div>
</template>
<script setup lang="ts">
import {
  ChevronBackOutline,
  ChevronForwardOutline,
  CheckmarkCircleOutline,
} from "@vicons/ionicons5";
import { useRoute } from "vue-router";
import watchApi, { type WatchCalendar, type WatchSession } from "@renderer/apis/watchHistory";
import WatchDayDialog from "@renderer/components/WatchDayDialog.vue";
import WatchStreamerAvatar from "@renderer/components/WatchStreamerAvatar.vue";
import WatchSessionEntry from "@renderer/components/WatchSessionEntry.vue";
import { monthCells, shiftMonth } from "@renderer/utils/watchCalendar";
import { playSession } from "@renderer/utils/pages";
const route = useRoute();
const id = Number(route.params.streamerId);
const memoryKey = `watch-calendar:${id}`;
let memory: { month?: string; date?: string } = {};
try {
  const value = JSON.parse(localStorage.getItem(memoryKey) || "{}");
  memory = value && typeof value === "object" ? value : {};
} catch {}
const data = ref<WatchCalendar>();
const mode = ref("calendar");
const selectedDate = ref(memory.date || "");
const showDay = ref(false);
const loading = ref(false);
const error = ref("");
const list = ref<WatchSession[]>([]);
const cursor = ref<number | null>(null);
let generation = 0;
const cells = computed(() => (data.value ? monthCells(data.value.month) : []));
const days = computed(() => new Map(data.value?.days.map((day) => [day.date, day]) || []));
const selectedSessions = computed(
  () => data.value?.sessions.filter((session) => session.date === selectedDate.value) || [],
);
const monthOptions = computed(() =>
  [...new Set([data.value?.month, ...(data.value?.availableMonths || [])])]
    .filter((m): m is string => Boolean(m))
    .sort()
    .reverse()
    .map((m) => ({ label: `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`, value: m })),
);
function remember() {
  try {
    localStorage.setItem(
      memoryKey,
      JSON.stringify({ month: data.value?.month, date: selectedDate.value }),
    );
  } catch {}
}
async function load(month?: string) {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const result = await watchApi.calendar(id, month);
    if (current !== generation) return;
    data.value = result;
    remember();
  } catch (e: any) {
    if (current === generation) error.value = String(e?.message || e || "获取日历失败");
  } finally {
    if (current === generation) loading.value = false;
  }
}
function selectDate(date: string) {
  selectedDate.value = date;
  showDay.value = true;
  remember();
}
function dayLabel(date: string) {
  const day = days.value.get(date);
  return `${date}，${day ? `${day.sessionCount} 场录像，${day.completedCount} 场已看完，${day.status === "watching" ? "观看中" : day.status === "completed" ? "全部看完" : "未观看"}` : "无录制记录"}`;
}
function ring(date: string) {
  const day = days.value.get(date)!;
  const progress = Math.max(5, Math.round((day.completedClips / day.totalClips) * 100));
  return `conic-gradient(var(--watch-warning) ${progress}%, var(--watch-border) 0)`;
}
async function more() {
  const current = generation;
  loading.value = true;
  error.value = "";
  try {
    const result = await watchApi.sessions({ streamerId: id, before: cursor.value || undefined });
    if (current !== generation) return;
    const keys = new Set(list.value.map((s) => s.key));
    list.value.push(...result.data.filter((s) => !keys.has(s.key)));
    cursor.value = result.nextCursor;
  } catch (e: any) {
    if (current === generation) error.value = String(e?.message || e);
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function refresh() {
  if (mode.value === "calendar") await load(data.value?.month);
  else {
    generation++;
    list.value = [];
    cursor.value = null;
    await more();
  }
}
async function play(session: WatchSession) {
  try {
    await playSession(session);
  } catch (e: any) {
    error.value = String(e?.message || e);
  }
}
watch(mode, refresh);
const focus = () => {
  if (!loading.value) void refresh();
};
onMounted(() => {
  void load(
    memory.month && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(memory.month) ? memory.month : undefined,
  );
  window.addEventListener("focus", focus);
});
onBeforeUnmount(() => {
  generation++;
  window.removeEventListener("focus", focus);
});
</script>
<style scoped>
.streamer-calendar-page {
  padding: 24px 16px;
}
.profile {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}
h1 {
  font-size: 23px;
  margin: 0;
  overflow-wrap: anywhere;
}
.profile p {
  margin: 6px 0 0;
  color: var(--watch-secondary);
  font-size: 13px;
}
.view-tools,
.month-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.view-tools {
  margin-bottom: 18px;
}
.calendar-shell {
  border: 1px solid var(--watch-border);
  border-radius: 18px;
  padding: 14px 10px;
}
.month-tools {
  margin-bottom: 20px;
}
.month-select {
  flex: 1;
  min-width: 0;
}
.month-tools :deep(button) {
  min-height: 44px;
}
.weekdays,
.month-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}
.weekdays {
  text-align: center;
  font-size: 12px;
  color: var(--watch-secondary);
  margin-bottom: 10px;
}
.calendar-day {
  min-height: 78px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--watch-soft);
  color: var(--watch-text);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px 0;
  cursor: pointer;
  font: inherit;
}
.calendar-day:hover {
  background: var(--watch-primary-bg);
}
.calendar-day:focus-visible,
.calendar-day.today {
  border-color: var(--watch-primary);
  outline: none;
}
.calendar-day.selected {
  background: var(--watch-primary-bg);
}
.calendar-day.outside {
  opacity: 0.3;
  cursor: default;
}
.calendar-day.completed {
  color: var(--watch-muted);
}
.day-number {
  font-size: 14px;
  font-weight: 500;
}
.day-icon {
  height: 18px;
  display: flex;
  align-items: center;
}
.day-count {
  font-size: 10px;
  color: inherit;
}
.unwatched-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--watch-info);
}
.progress-ring,
.legend-progress {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  position: relative;
}
.progress-ring::after {
  content: "";
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--bg-primary, #fff);
}
.legend-progress {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid var(--watch-warning);
  border-right-color: var(--watch-border);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--watch-border);
  font-size: 11px;
  color: var(--watch-secondary);
}
.legend > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend-empty {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid var(--watch-border);
}
.calendar-note {
  font-size: 12px;
  color: var(--watch-secondary);
  margin: 14px 0;
}
.session-list {
  display: grid;
  gap: 12px;
  margin: 16px 0;
}
@media (min-width: 629px) {
  .calendar-shell {
    padding: 24px;
  }
  .calendar-day {
    min-height: 96px;
  }
  .day-count {
    font-size: 12px;
  }
}
</style>
