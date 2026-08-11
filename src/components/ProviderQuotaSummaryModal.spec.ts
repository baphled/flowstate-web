import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ProviderQuotaSummaryModal from "./ProviderQuotaSummaryModal.vue";
import { useQuotaStore } from "@/stores/quotaStore";
import type { SSEProviderQuotaEvent } from "@/lib/sseEvent";

/**
 * ProviderQuotaSummaryModal specs — verify the summary modal renders
 * every observed provider snapshot with the correct summary label.
 */

function baseSnapshot(variant: "rate_limit" | "token_spend" | "not_configured"): SSEProviderQuotaEvent {
  return {
    kind: "provider_quota",
    provider: "anthropic",
    accountHash: "a1b2c3d4",
    model: "claude-opus-4-7",
    observedAt: "2026-05-13T12:00:00Z",
    stale: false,
    storeBackend: "memory",
    pricingSource: "flowstate-default-v1",
    variant,
    rateLimit: null,
    tokenSpend: null,
    notConfigured: null,
  };
}

describe("ProviderQuotaSummaryModal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("visibility", () => {
    it("does not render when open=false", async () => {
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: false } });
      await flushPromises();
      expect(wrapper.find('[data-testid="quota-summary-overlay"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="quota-summary-panel"]').exists()).toBe(false);
    });

    it("renders the overlay and panel when open=true", async () => {
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      expect(wrapper.find('[data-testid="quota-summary-overlay"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="quota-summary-panel"]').exists()).toBe(true);
    });
  });

  describe("empty state", () => {
    it("shows empty-state text when no snapshots exist", async () => {
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      const empty = wrapper.find('[data-testid="quota-summary-empty"]');
      expect(empty.exists()).toBe(true);
      expect(empty.text()).toContain("No provider quota data yet.");
    });
  });

  describe("all not-configured state", () => {
    it("shows all-not-configured hint when every snapshot is not_configured", async () => {
      const store = useQuotaStore();
      store.applyProviderQuotaEvent({
        ...baseSnapshot("not_configured"),
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        notConfigured: { reason: "awaiting-first-response" },
      });
      store.applyProviderQuotaEvent({
        ...baseSnapshot("not_configured"),
        provider: "openai",
        model: "gpt-4o",
        notConfigured: { reason: "no-quota-store" },
      });

      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      const hint = wrapper.find('[data-testid="quota-summary-all-nc"]');
      expect(hint.exists()).toBe(true);
      expect(hint.text()).toContain("not configured");
    });
  });

  describe("entry rendering", () => {
    function seedRateLimit(pct: number, resetIso: string) {
      useQuotaStore().applyProviderQuotaEvent({
        ...baseSnapshot("rate_limit"),
        rateLimit: {
          requests: { limit: 1000, remaining: Math.round(1000 * pct / 100), reset: resetIso },
          tokens: { limit: 100000, remaining: Math.round(100000 * pct / 100), reset: resetIso },
          input: { limit: -1, remaining: -1, reset: "" },
          output: { limit: -1, remaining: -1, reset: "" },
          tightestPercentRemaining: pct,
          tightestResetAt: resetIso,
        },
      });
    }

    function seedTokenSpend(spentMinor: number, capMinor: number) {
      useQuotaStore().applyProviderQuotaEvent({
        ...baseSnapshot("token_spend"),
        tokenSpend: {
          spentMinor,
          spentCurrency: "USD",
          spentUsdMinor: spentMinor,
          capMinor,
          capCurrency: "USD",
          period: "monthly",
          periodStart: "2026-05-01T00:00:00Z",
          periodEnd: "2026-06-01T00:00:00Z",
          thresholdAmber: 80,
          thresholdRed: 95,
        },
      });
    }

    it("renders multiple entries sorted by provider then model", async () => {
      useQuotaStore().applyProviderQuotaEvent({
        ...baseSnapshot("rate_limit"),
        provider: "zai",
        accountHash: "z1",
        model: "z-model",
        rateLimit: {
          requests: { limit: 1000, remaining: 500, reset: "" },
          tokens: { limit: 100000, remaining: 50000, reset: "" },
          input: { limit: -1, remaining: -1, reset: "" },
          output: { limit: -1, remaining: -1, reset: "" },
          tightestPercentRemaining: 50,
          tightestResetAt: "",
        },
      });
      useQuotaStore().applyProviderQuotaEvent({
        ...baseSnapshot("not_configured"),
        provider: "anthropic",
        accountHash: "a1",
        model: "claude-sonnet",
        notConfigured: { reason: "awaiting-first-response" },
      });
      useQuotaStore().applyProviderQuotaEvent({
        ...baseSnapshot("token_spend"),
        provider: "openai",
        accountHash: "o1",
        model: "gpt-4o",
        tokenSpend: {
          spentMinor: 500,
          spentCurrency: "USD",
          spentUsdMinor: 500,
          capMinor: 10000,
          capCurrency: "USD",
          period: "monthly",
          periodStart: "2026-05-01T00:00:00Z",
          periodEnd: "2026-06-01T00:00:00Z",
          thresholdAmber: 80,
          thresholdRed: 95,
        },
      });

      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();

      const entries = wrapper.findAll('[data-testid^="quota-summary-entry-"]');
      expect(entries.length).toBe(3);

      const firstProvider = entries[0].find('[data-testid="entry-provider"]');
      expect(firstProvider.exists()).toBe(true);
      expect(firstProvider.text()).toBe("anthropic");

      const lastProvider = entries[2].find('[data-testid="entry-provider"]');
      expect(lastProvider.text()).toBe("zai");
    });

    it("shows rate_limit summary line with percent remaining", async () => {
      seedRateLimit(42, "2026-05-13T12:03:00Z");
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      const summary = wrapper.find('[data-testid="entry-summary"]');
      expect(summary.text()).toContain("42%");
      expect(summary.text()).toContain("remaining");
    });

    it("shows token_spend summary line with spend / cap", async () => {
      seedTokenSpend(241, 5000);
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      const summary = wrapper.find('[data-testid="entry-summary"]');
      expect(summary.text()).toContain("$2.41");
      expect(summary.text()).toContain("$50.00");
    });

    it("shows not_configured reason in summary", async () => {
      useQuotaStore().applyProviderQuotaEvent({
        ...baseSnapshot("token_spend"),
        provider: "openai",
        accountHash: "o1",
        model: "gpt-4o",
        tokenSpend: {
          spentMinor: 500,
          spentCurrency: "USD",
          spentUsdMinor: 500,
          capMinor: 10000,
          capCurrency: "USD",
          period: "monthly",
          periodStart: "2026-05-01T00:00:00Z",
          periodEnd: "2026-06-01T00:00:00Z",
          thresholdAmber: 80,
          thresholdRed: 95,
        },
      });
      useQuotaStore().applyProviderQuotaEvent({
        ...baseSnapshot("not_configured"),
        provider: "anthropic",
        accountHash: "a1",
        model: "claude-sonnet",
        notConfigured: { reason: "api-key-missing" },
      });
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      const entries = wrapper.findAll('[data-testid="entry-summary"]');
      expect(entries.length).toBe(2);
      expect(entries[0].text()).toContain("api-key-missing");
    });

    it("shows stale tag when snapshot.stale is true", async () => {
      useQuotaStore().applyProviderQuotaEvent({
        ...baseSnapshot("rate_limit"),
        stale: true,
        rateLimit: {
          requests: { limit: 1000, remaining: 500, reset: "" },
          tokens: { limit: 100000, remaining: 50000, reset: "" },
          input: { limit: -1, remaining: -1, reset: "" },
          output: { limit: -1, remaining: -1, reset: "" },
          tightestPercentRemaining: 50,
          tightestResetAt: "",
        },
      });
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      expect(wrapper.find('[data-testid="entry-stale-tag"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="entry-stale-tag"]').text()).toBe("Stale");
    });

    it("renders provider, model, and variant badge per entry", async () => {
      useQuotaStore().applyProviderQuotaEvent({
        ...baseSnapshot("token_spend"),
        provider: "openai",
        model: "gpt-4o",
        tokenSpend: {
          spentMinor: 500,
          spentCurrency: "USD",
          spentUsdMinor: 500,
          capMinor: 10000,
          capCurrency: "USD",
          period: "monthly",
          periodStart: "2026-05-01T00:00:00Z",
          periodEnd: "2026-06-01T00:00:00Z",
          thresholdAmber: 80,
          thresholdRed: 95,
        },
      });
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      expect(wrapper.find('[data-testid="entry-provider"]').text()).toBe("openai");
      expect(wrapper.find('[data-testid="entry-model"]').text()).toBe("gpt-4o");
      expect(wrapper.find('[data-testid="entry-variant-badge"]').text()).toBe("Spend");
    });
  });

  describe("close behaviour", () => {
    it('emits "close" on Escape keydown', async () => {
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it('emits "close" on backdrop click', async () => {
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      await wrapper.find('[data-testid="quota-summary-overlay"]').trigger("click");
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it('emits "close" on X button click', async () => {
      const wrapper = mount(ProviderQuotaSummaryModal, { props: { open: true } });
      await flushPromises();
      await wrapper.find('[data-testid="quota-summary-close"]').trigger("click");
      expect(wrapper.emitted("close")).toHaveLength(1);
    });
  });
});
