import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import SwarmRunTree from "@/components/swarm/SwarmRunTree.vue";
import { useSwarmStore } from "@/stores/swarmStore";
import type { SwarmEvent } from "@/types";

function makeEvent(overrides: Partial<SwarmEvent>): SwarmEvent {
  return {
    id: "evt-1",
    type: "delegation",
    timestamp: "2026-08-23T00:00:00Z",
    agent_id: "lead",
    ...overrides,
  } as SwarmEvent;
}

describe("SwarmRunTree", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders nothing when there is no run tree", () => {
    const wrapper = mount(SwarmRunTree);
    expect(wrapper.find('[data-testid="swarm-run-tree"]').exists()).toBe(false);
  });

  it("renders a tree with role=tree/treeitem, status badges, and gate verdicts", () => {
    const store = useSwarmStore();
    store.events = [
      makeEvent({
        id: "evt-1",
        swarm_id: "swarm-a",
        member_id: "Senior-Engineer",
        member_type: "agent",
        lifecycle: "started",
      }),
      makeEvent({
        id: "evt-2",
        swarm_id: "swarm-a",
        member_id: "bug-hunt",
        parent_chain: "swarm-a",
        member_type: "swarm",
        lifecycle: "started",
      }),
      makeEvent({
        id: "evt-3",
        swarm_id: "swarm-a",
        member_id: "explorer",
        parent_chain: "swarm-a/bug-hunt",
        member_type: "agent",
        lifecycle: "failed",
      }),
      makeEvent({
        id: "evt-4",
        type: "gate_failed",
        swarm_id: "swarm-a",
        member_id: "explorer",
        metadata: { gate_name: "result-schema", reason: "bad shape" },
      }),
    ];

    const wrapper = mount(SwarmRunTree);
    expect(wrapper.find('[role="tree"]').exists()).toBe(true);
    expect(wrapper.findAll('[role="treeitem"]').length).toBeGreaterThanOrEqual(3);
    // Sub-swarm node is present and expandable.
    const subSwarm = wrapper.find('[data-testid="run-tree-node-bug-hunt"]');
    expect(subSwarm.exists()).toBe(true);
    expect(subSwarm.attributes("aria-expanded")).toBe("true");
    // Nested member status badge.
    expect(
      wrapper.find('[data-testid="run-tree-status-explorer"]').text(),
    ).toBe("failed");
    // Gate verdict attached.
    const gate = wrapper.find('[data-testid="run-tree-gate-explorer"]');
    expect(gate.exists()).toBe(true);
    expect(gate.text()).toContain("result-schema");
    expect(gate.text()).toContain("bad shape");
  });

  it("announces status changes via aria-live=polite", async () => {
    const store = useSwarmStore();
    store.events = [
      makeEvent({
        id: "evt-1",
        swarm_id: "swarm-a",
        member_id: "worker",
        lifecycle: "started",
      }),
    ];
    const wrapper = mount(SwarmRunTree);
    const live = wrapper.find('[data-testid="run-tree-announcement"]');
    expect(live.attributes("aria-live")).toBe("polite");
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(live.text()).toContain("1 running");

    // Transition to completed.
    store.events = [
      makeEvent({
        id: "evt-1",
        swarm_id: "swarm-a",
        member_id: "worker",
        lifecycle: "completed",
      }),
    ];
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="run-tree-announcement"]').text()).toContain(
      "1 completed",
    );
  });

  it("shows the inferred badge when the tree came from the fallback path", () => {
    const store = useSwarmStore();
    store.events = [
      makeEvent({ id: "lead/worker-a", status: "start", agent_id: "lead" }),
      makeEvent({ id: "lead/worker-b", status: "complete", agent_id: "lead" }),
    ];
    const wrapper = mount(SwarmRunTree);
    expect(
      wrapper.find('[data-testid="run-tree-fallback"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[role="tree"]').exists()).toBe(true);
  });
});
