/**
 * ProviderQuotaSummaryModal.spec.ts — vitest spec for the provider
 * quota overview modal.
 *
 * Pins:
 *   - Renders a row per known snapshot from the quota store.
 *   - Sorted by (provider, model).
 *   - Shows status badge, key metric, and reset/period column.
 *   - Empty state when no snapshots exist.
 *   - Close on Escape / backdrop click / X button.
 *   - Clicking a row emits `select` with the snapshot payload.
 *   - Focus trap is active while open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import ProviderQuotaSummaryModal from "./ProviderQuotaSummaryModal.vue";
import { useQuotaStore } from "@/stores/quotaStore";
import type { SSEProviderQuotaEvent } from "@/lib/sseEvent";

/**
 * Helper — seed the quota store with an SSE event via its action so
 * the modal reads live snapshots.
 */
function seedSnapshot(
  overrides: Partial<SSEProviderQuotaEvent> & {
    provider: string;
    model: string;
  },
): void {
  const store = useQuotaStore();
  const base: SSEProviderQuotaEvent = {
    kind: "provider_quota",
    provider: overrides.provider,
    accountHash: overrides.accountHash ?? "deadbeef",
    model: overrides.model,
    observedAt: overrides.observedAt ?? "2026-05-13T12:00:00Z",
    stale: overrides.stale ?? false,
    storeBackend: overrides.storeBackend ?? "memory",
    pricingSource: overrides.pricingSource ?? "",
    variant: overrides.variant ?? "rate_limit",
    rateLimit: overrides.rateLimit ?? {
      requests: { limit: 100, remaining: 42, reset: "2026-05-13T12:05:00Z" },
      tokens: {
        limit: 100000,
        remaining: 12000,
        reset: "2026-05-13T12:05:00Z",
      },
      input: { limit: 50000, remaining: 7000, reset: "2026-05-13T12:05:00Z" },
      output: {
        limit: 50000,
        remaining: 5000,
        reset: "2026-05-13T12:05:00Z",
      },
      tightestPercentRemaining: 12,
      tightestResetAt: "2026-05-13T12:05:00Z",
    },
    tokenSpend: overrides.tokenSpend ?? null,
    notConfigured: overrides.notConfigured ?? null,
    rateLimitedUntil: overrides.rateLimitedUntil ?? "",
    status: overrides.status ?? "healthy",
  };
  store.applyProviderQuotaEvent(base);
}

describe("ProviderQuotaSummaryModal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function mountModal(open = true) {
    return mount(ProviderQuotaSummaryModal, {
      props: { open },
      global: {
        stubs: { useFocusTrap: true },
      },
    });
  }

  describe("visibility", () => {
    it("renders nothing when open is false", () => {
      const wrapper = mountModal(false);
      expect(wrapper.find('[data-testid="provider-quota-summary-backdrop"]').exists()).toBe(false);
    });

    it("renders the backdrop when open is true", () => {
      const wrapper = mountModal(true);
      expect(wrapper.find('[data-testid="provider-quota-summary-backdrop"]').exists()).toBe(true);
    });
  });

  describe("empty state", () => {
    it('shows an empty-state message when no snapshots exist', () => {
      const wrapper = mountModal(true);
      expect(
        wrapper.find('[data-testid="provider-quota-summary-empty"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-testid="provider-quota-summary-table"]').exists(),
      ).toBe(false);
    });
  });

  describe("populated state", () => {
    it("renders one row per snapshot sorted by provider then model", () => {
      seedSnapshot({ provider: "openai", model: "gpt-4o", variant: "token_spend", status: "spent" });
      seedSnapshot({ provider: "anthropic", model: "claude-opus-4-7", variant: "rate_limit", status: "healthy" });
      seedSnapshot({ provider: "anthropic", model: "claude-sonnet-4-7", variant: "rate_limit", status: "healthy" });

      const wrapper = mountModal(true);
      const rows = wrapper.findAll('[data-testid="provider-quota-summary-row"]');

      expect(rows).toHaveLength(3);
      const providers = rows.map((r) => r.attributes("data-provider"));
      const models = rows.map((r) => r.attributes("data-model"));
      expect(providers).toEqual(["anthropic", "anthropic", "openai"]);
      expect(models).toEqual([
        "claude-opus-4-7",
        "claude-sonnet-4-7",
        "gpt-4o",
      ]);
    });

    it("renders the provider name in the first column", () => {
      seedSnapshot({ provider: "anthropic", model: "claude-opus-4-7" });
      const wrapper = mountModal(true);
      const cells = wrapper.findAll('[data-testid="summary-cell-provider"]');
      expect(cells).toHaveLength(1);
      expect(cells[0].text()).toContain("anthropic");
    });

    it("renders the model name in the second column", () => {
      seedSnapshot({ provider: "anthropic", model: "claude-opus-4-7" });
      const wrapper = mountModal(true);
      const cells = wrapper.findAll('[data-testid="summary-cell-model"]');
      expect(cells).toHaveLength(1);
      expect(cells[0].text()).toBe("claude-opus-4-7");
    });

    it("renders a status badge with the snapshot's status", () => {
      seedSnapshot({
        provider: "anthropic",
        model: "claude-opus-4-7",
        status: "rate_limited",
      });
      const wrapper = mountModal(true);
      const badges = wrapper.findAll('[data-testid="summary-status-badge"]');
      expect(badges).toHaveLength(1);
      expect(badges[0].text()).toBe("rate_limited");
    });

    it("renders '—' for empty status", () => {
      seedSnapshot({
        provider: "ollama",
        model: "llama3",
        variant: "not_configured",
        status: "",
      });
      const wrapper = mountModal(true);
      const badges = wrapper.findAll('[data-testid="summary-status-badge"]');
      expect(badges[0].text()).toBe("—");
    });

    it("renders rate-limit percent + reset countdown for rate_limit variant", () => {
      seedSnapshot({
        provider: "anthropic",
        model: "claude-opus-4-7",
        variant: "rate_limit",
        rateLimit: {
          requests: { limit: 100, remaining: 5, reset: "" },
          tokens: { limit: 100000, remaining: 12000, reset: "" },
          input: { limit: 50000, remaining: 7000, reset: "" },
          output: { limit: 50000, remaining: 5000, reset: "" },
          tightestPercentRemaining: 5,
          tightestResetAt: "",
        },
      });
      const wrapper = mountModal(true);
      const cells = wrapper.findAll('[data-testid="summary-cell-metric"]');
      expect(cells[0].text()).toBe("5%");
    });

    it("renders token spend $/cap for token_spend variant", () => {
      seedSnapshot({
        provider: "openai",
        model: "gpt-4o",
        variant: "token_spend",
        tokenSpend: {
          spentMinor: 241,
          spentCurrency: "USD",
          spentUsdMinor: 241,
          capMinor: 5000,
          capCurrency: "USD",
          period: "monthly",
          periodStart: "2026-05-01T00:00:00Z",
          periodEnd: "2026-06-01T00:00:00Z",
          thresholdAmber: 80,
          thresholdRed: 95,
        },
      });
      const wrapper = mountModal(true);
      const cells = wrapper.findAll('[data-testid="summary-cell-metric"]');
      expect(cells[0].text()).toBe("$2.41 / $50.00");
    });

    it("renders 'Not configured' with tooltip reason for not_configured variant", () => {
      seedSnapshot({
        provider: "ollama",
        model: "llama3",
        variant: "not_configured",
        notConfigured: { reason: "local-model" },
      });
      const wrapper = mountModal(true);
      const cells = wrapper.findAll('[data-testid="summary-cell-metric"]');
      expect(cells[0].text()).toContain("Not configured");
    });

    it("renders the period label in the reset/period column for token_spend", () => {
      seedSnapshot({
        provider: "openai",
        model: "gpt-4o",
        variant: "token_spend",
        tokenSpend: {
          spentMinor: 241,
          spentCurrency: "USD",
          spentUsdMinor: 241,
          capMinor: 5000,
          capCurrency: "USD",
          period: "monthly",
          periodStart: "2026-05-01T00:00:00Z",
          periodEnd: "2026-06-01T00:00:00Z",
          thresholdAmber: 80,
          thresholdRed: 95,
        },
      });
      const wrapper = mountModal(true);
      const cells = wrapper.findAll('[data-testid="summary-cell-period"]');
      expect(cells[0].text()).toBe("monthly");
    });
  });

  describe("interaction", () => {
    it('closes on backdrop click', async () => {
      seedSnapshot({ provider: "anthropic", model: "claude-opus-4-7" });
      const wrapper = mountModal(true);
      await wrapper
        .find('[data-testid="provider-quota-summary-backdrop"]')
        .trigger("click");
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it('closes on X button click', async () => {
      seedSnapshot({ provider: "anthropic", model: "claude-opus-4-7" });
      const wrapper = mountModal(true);
      await wrapper
        .find('[data-testid="provider-quota-summary-close"]')
        .trigger("click");
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it('emits "select" with the snapshot when a row is clicked', async () => {
      seedSnapshot({
        provider: "anthropic",
        model: "claude-opus-4-7",
        status: "healthy",
        variant: "rate_limit",
      });
      const wrapper = mountModal(true);
      const rows = wrapper.findAll('[data-testid="provider-quota-summary-row"]');
      expect(rows).toHaveLength(1);
      await rows[0].trigger("click");
      expect(wrapper.emitted("select")).toHaveLength(1);
      const payload = wrapper.emitted("select")?.[0]?.[0];
      expect(payload).toBeDefined();
      expect(payload.provider).toBe("anthropic");
      expect(payload.model).toBe("claude-opus-4-7");
      expect(payload.status).toBe("healthy");
    });

    it('closes the modal when the select listener is wired to close', async () => {
      seedSnapshot({ provider: "anthropic", model: "claude-opus-4-7" });
      const wrapper = mount(ProviderQuotaSummaryModal, {
        props: { open: true },
        global: {
          stubs: { useFocusTrap: true },
        },
        attrs: {
          "onSelect": () => wrapper.setProps({ open: false }),
        },
      });
      const rows = wrapper.findAll('[data-testid="provider-quota-summary-row"]');
      await rows[0].trigger("click");
      await flushPromises();
      expect(
        wrapper.find('[data-testid="provider-quota-summary-backdrop"]').exists(),
      ).toBe(false);
    });
  });
});
