<template>
  <n-avatar
    v-if="avatar"
    round
    :size="size"
    :src="avatar"
    :img-props="{ referrerpolicy: 'no-referrer' }"
  >
    <template #fallback>{{ streamer.name.slice(0, 1) }}</template>
  </n-avatar>
  <n-avatar v-else round :size="size">{{ streamer.name.slice(0, 1) }}</n-avatar>
</template>
<script setup lang="ts">
import watchApi, { type WatchStreamer } from "@renderer/apis/watchHistory";
const props = withDefaults(
  defineProps<{
    streamer: Pick<WatchStreamer, "id" | "name" | "avatar">;
    size?: number;
  }>(),
  { size: 56 },
);
const avatar = ref<string | null>(props.streamer.avatar);
let generation = 0;
watch(
  () => [props.streamer.id, props.streamer.avatar] as const,
  async () => {
    const current = ++generation;
    avatar.value = props.streamer.avatar;
    try {
      const image = await watchApi.streamerAvatar(props.streamer.id);
      if (current === generation && image) avatar.value = image;
    } catch {
      /* Keep the cached image while the room is unavailable. */
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
</script>
