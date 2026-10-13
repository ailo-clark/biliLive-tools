<template>
  <n-tooltip>
    <template #trigger>
      <n-button
        quaternary
        circle
        :size="compact ? 'tiny' : 'small'"
        :class="{ compact }"
        class="watch-toggle"
        :aria-label="label"
        :title="label"
        :loading="loading"
        @click="$emit('click')"
      >
        <n-icon :size="20" :color="completed ? '#18a058' : undefined">
          <CheckmarkCircle v-if="completed" /><CheckmarkCircleOutline v-else />
        </n-icon>
      </n-button>
    </template>
    {{ label }}
  </n-tooltip>
</template>
<script setup lang="ts">
import { CheckmarkCircle, CheckmarkCircleOutline } from "@vicons/ionicons5";
const props = defineProps<{ completed?: boolean; compact?: boolean; loading?: boolean }>();
defineEmits<{ (event: "click"): void }>();
const label = computed(() => (props.completed ? "标记未看" : "标记已看完"));
</script>
<style scoped>
.watch-toggle {
  min-width: 44px;
  min-height: 44px;
}
.watch-toggle.compact {
  min-width: 24px;
  min-height: 24px;
  width: 24px;
  height: 24px;
}
</style>
