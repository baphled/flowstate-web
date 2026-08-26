<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useSwarmStore } from "@/stores/swarmStore";
import type {
  SwarmRunTree as SwarmRunTreeT,
  SwarmTreeNode,
} from "@/stores/swarmStore";

defineOptions({ name: "SwarmRunTree" });

const swarmStore = useSwarmStore();

const tree = computed(() => swarmStore.runTree);

const announcement = ref("");

function buildAnnouncement(): void {
  const summary = swarmStore.runTree;
  if (!summary) return;
  const counts = { running: 0, done: 0, failed: 0, pending: 0 };
  const walk = (nodes: SwarmTreeNode[]): void => {
    for (const n of nodes) {
      counts[n.status] += 1;
      walk(n.children);
    }
  };
  walk(summary.members);
  announcement.value = `Swarm ${summary.swarmId}: ${counts.running} running, ${counts.done} completed, ${counts.failed} failed, ${counts.pending} pending`;
}

onMounted(() => {
  buildAnnouncement();
});

watch(
  () => JSON.stringify(serialize(swarmStore.runTree)),
  () => buildAnnouncement(),
);

// Expanded sub-swarm nodes — keyed by node key; sub-swarms start expanded.
const expanded = ref<Set<string>>(new Set());

function isExpandable(node: SwarmTreeNode): boolean {
  return node.memberType === "swarm" || node.children.length > 0;
}

function toggle(node: SwarmTreeNode): void {
  const next = new Set(expanded.value);
  if (next.has(node.key)) {
    next.delete(node.key);
  } else {
    next.add(node.key);
  }
  expanded.value = next;
}

function isOpen(node: SwarmTreeNode): boolean {
  return expanded.value.has(node.key) || node.memberType === "swarm";
}

const statusLabel: Record<string, string> = {
  pending: "pending",
  running: "running",
  done: "completed",
  failed: "failed",
};

// Coarse change signal for the watch — serialises id/status pairs.
function serialize(
  t: SwarmRunTreeT | null,
): Array<{ id: string; status: string }> | null {
  if (!t) return null;
  const out: Array<{ id: string; status: string }> = [];
  const walk = (nodes: SwarmTreeNode[]): void => {
    for (const n of nodes) {
      out.push({ id: n.id, status: n.status });
      walk(n.children);
    }
  };
  walk(t.members);
  return out;
}
</script>

<template>
  <section
    v-if="tree"
    class="swarm-run-tree"
    data-testid="swarm-run-tree"
    aria-label="Swarm run tree"
  >
    <header class="run-tree-header">
      <span class="run-tree-title">{{ tree.swarmId }}</span>
      <span
        v-if="!tree.hierarchical"
        class="run-tree-fallback"
        data-testid="run-tree-fallback"
        >inferred</span
      >
    </header>
    <p class="sr-only" aria-live="polite" data-testid="run-tree-announcement">
      {{ announcement }}
    </p>
    <ul role="tree" data-testid="run-tree-root" class="run-tree-list">
      <li
        v-for="node in tree.members"
        :key="node.key"
        role="treeitem"
        :aria-expanded="isExpandable(node) ? isOpen(node) : undefined"
        :data-testid="`run-tree-node-${node.id}`"
        class="run-tree-node"
        :class="`node-type-${node.memberType}`"
      >
        <div class="node-row">
          <button
            v-if="isExpandable(node)"
            type="button"
            class="node-toggle"
            :aria-label="`${isOpen(node) ? 'Collapse' : 'Expand'} ${node.id}`"
            :data-testid="`run-tree-toggle-${node.id}`"
            @click="toggle(node)"
          >
            {{ isOpen(node) ? "▾" : "▸" }}
          </button>
          <span v-else class="node-toggle-placeholder" aria-hidden="true" />
          <span class="node-id">{{ node.id }}</span>
          <span
            class="node-status-badge"
            :class="`status-${node.status}`"
            :data-testid="`run-tree-status-${node.id}`"
            >{{ statusLabel[node.status] ?? node.status }}</span
          >
        </div>
        <ul
          v-if="isExpandable(node) && isOpen(node)"
          role="group"
          class="run-tree-children"
        >
          <li
            v-for="child in node.children"
            :key="child.key"
            role="treeitem"
            :aria-expanded="
              isExpandable(child) ? isOpen(child) : undefined
            "
            :data-testid="`run-tree-node-${child.id}`"
            class="run-tree-node"
            :class="`node-type-${child.memberType}`"
          >
            <div class="node-row">
              <button
                v-if="isExpandable(child)"
                type="button"
                class="node-toggle"
                :aria-label="`${isOpen(child) ? 'Collapse' : 'Expand'} ${child.id}`"
                @click="toggle(child)"
              >
                {{ isOpen(child) ? "▾" : "▸" }}
              </button>
              <span v-else class="node-toggle-placeholder" aria-hidden="true" />
              <span class="node-id">{{ child.id }}</span>
              <span
                class="node-status-badge"
                :class="`status-${child.status}`"
                :data-testid="`run-tree-status-${child.id}`"
                >{{ statusLabel[child.status] ?? child.status }}</span
              >
            </div>
            <ul v-if="child.gates.length > 0" class="node-gates">
              <li
                v-for="(gate, i) in child.gates"
                :key="`${child.key}-gate-${i}`"
                class="node-gate"
                :data-testid="`run-tree-gate-${child.id}`"
              >
                <span class="gate-name">{{ gate.gateName }}</span>
                <span v-if="gate.reason" class="gate-reason">{{
                  gate.reason
                }}</span>
              </li>
            </ul>
          </li>
        </ul>
        <ul v-if="node.gates.length > 0" class="node-gates">
          <li
            v-for="(gate, i) in node.gates"
            :key="`${node.key}-gate-${i}`"
            class="node-gate"
            :data-testid="`run-tree-gate-${node.id}`"
          >
            <span class="gate-name">{{ gate.gateName }}</span>
            <span v-if="gate.reason" class="gate-reason">{{
              gate.reason
            }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.swarm-run-tree {
  padding: 0.6rem 0.8rem;
  background: var(--bg-elevated);
  border-left: 3px solid var(--border);
  border-radius: 0 var(--radius) var(--radius) 0;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
}

.run-tree-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.run-tree-title {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-primary);
}

.run-tree-fallback {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.run-tree-list,
.run-tree-children,
.node-gates {
  list-style: none;
  padding-left: 0;
  margin: 0;
}

.run-tree-children {
  padding-left: 1rem;
}

.run-tree-node {
  margin: 0.15rem 0;
}

.node-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.node-toggle {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.8rem;
  width: 1rem;
  padding: 0;
}

.node-toggle-placeholder {
  display: inline-block;
  width: 1rem;
}

.node-id {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.node-type-swarm .node-id {
  font-weight: 600;
}

.node-status-badge {
  margin-left: auto;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.status-running {
  color: var(--event-delegation, #0a7);
}
.status-done {
  color: #0a7;
}
.status-failed {
  color: #c00;
}

.node-gates {
  padding-left: 1.4rem;
  margin-top: 0.15rem;
}

.node-gate {
  font-size: 0.72rem;
  color: #c00;
}

.gate-name {
  font-family: var(--font-mono);
  font-weight: 600;
  margin-right: 0.4rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
