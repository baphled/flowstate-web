<script setup lang="ts">
import type { ToolRendererProps } from "./toolRendererProps";

defineProps<ToolRendererProps>();
</script>

<template>
  <span class="skill-load-label" data-testid="skill-load-label">
    {{ heading }}
  </span>
</template>

<style scoped>
.skill-load-label {
  font-size: 0.85rem;
  color: var(--text-primary, #c0caf5);
}
</style>
