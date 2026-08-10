<script setup lang="ts">
import { computed } from "vue";
import HighlightedCode from "./HighlightedCode.vue";
import ToolBubble from "./ToolBubble.vue";
import type { ToolRendererProps } from "./toolRendererProps";

const maxToolInputLength = 200;

const props = withDefaults(defineProps<ToolRendererProps>(), {
  status: "completed",
});

const truncatedToolInput = computed(() => {
  if (!props.toolInput) {
    return "";
  }

  if (props.toolInput.length <= maxToolInputLength) {
    return props.toolInput;
  }

  return `${props.toolInput.slice(0, maxToolInputLength)}...`;
});
</script>

<template>
  <ToolBubble
    :tool-name="props.toolName"
    :title="props.toolName"
    :subtitle="props.heading"
    :status="props.status"
    :default-open="true"
  >
    <div class="tool-renderer" data-component="generic-tool">
      <section v-if="truncatedToolInput" class="tool-section">
        <span class="tool-section__label">Input</span>
        <HighlightedCode :code="truncatedToolInput" lang="json" />
      </section>

      <section class="tool-section" data-component="generic-tool-output">
        <span class="tool-section__label">Output</span>
        <HighlightedCode :code="props.body" />
      </section>
    </div>
  </ToolBubble>
</template>

<style scoped>
.tool-renderer {
  display: grid;
  gap: 0.85rem;
}

.tool-section {
  display: grid;
  gap: 0.45rem;
}

.tool-section__label {
  color: var(--text-secondary, #a9b1d6);
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
}
</style>
