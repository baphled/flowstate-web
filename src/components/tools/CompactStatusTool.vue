<script setup lang="ts">
import { computed, watch } from "vue";
import type { ToolRendererProps } from "./toolRendererProps";
import { showToast } from "@/composables/useToast";

const props = withDefaults(defineProps<ToolRendererProps>(), {
  status: "completed",
});

watch(
  () => props.status,
  (newStatus) => {
    if (newStatus === "error") {
      showToast({
        title: "Tool failed",
        message: `${props.toolName}: ${props.heading}`,
        variant: "error",
        duration: 5000,
      });
    }
  },
);

const glyph = computed(() => {
  switch (props.status) {
    case "pending":
    case "running":
      return "⟳";
    case "completed":
      return "✓";
    case "error":
      return "✕";
    default:
      return "";
  }
});

const isSpinning = computed(
  () => props.status === "pending" || props.status === "running",
);
</script>

<template>
  <div>
    <div
      v-if="status !== 'error'"
      class="compact-status-tool"
      data-testid="compact-status-tool"
    >
      <span class="compact-status-tool__label">{{ heading }}</span>
      <span
        class="compact-status-tool__glyph"
        :class="{ 'compact-status-tool__glyph--spinning': isSpinning }"
        data-testid="compact-status-glyph"
      >{{ glyph }}</span>
    </div>
  </div>
</template>

<style scoped>
.compact-status-tool {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.compact-status-tool__label {
  font-size: 0.85rem;
  color: var(--text-primary, #c0caf5);
}

.compact-status-tool__glyph {
  font-size: 0.85rem;
  min-width: 1rem;
  display: flex;
  justify-content: center;
  align-items: center;
}

.compact-status-tool__glyph--spinning {
  animation: compact-spin 1s linear infinite;
}

@keyframes compact-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
