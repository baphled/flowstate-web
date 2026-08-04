<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { useQuotaStore, snapshotKey, type ProviderQuotaSnapshot } from "@/stores/quotaStore";

/**
 * ProviderQuotaSummaryModal — modal overview of every known
 * provider/model quota snapshot currently in the in-memory store.
 *
 * Reads directly from useQuotaStore().snapshots so the table always
 * reflects the latest SSE / turn-poll data without a separate fetch.
 *
 * Columns:
 *   - Provider + Model (grouped by provider)
 *   - Status — colour-coded health indicator
 *   - Key Metric — rate-limit %, token-spend $/cap, or "Not configured"
 *   - Reset / Period — countdown for rate_limit, period label for
 *     token_spend, — for not_configured
 *
 * Clicking a row emits `select` with that snapshot's partition key so
 * the parent can open the deep-dive ProviderQuotaPanel. Close on
 * Escape / backdrop click / X button.
 */
defineOptions({ name: "ProviderQuotaSummaryModal" });

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  select: [snapshot: ProviderQuotaSnapshot];
}>();

const modalEl = ref<HTMLElement | null>(null);

useFocusTrap(modalEl, toRef(props, "open"));

const quotaStore = useQuotaStore();

/**
 * allSnapshots — flat list of every ProviderQuotaSnapshot currently
 * in the store, sorted by (provider, model) for stable rendering.
 */
const allSnapshots = computed<ProviderQuotaSnapshot[]>(() => {
  return Object.values(quotaStore.snapshots).sort((a, b) => {
    const pc = a.provider.localeCompare(b.provider);
    if (pc !== 0) return pc;
    return a.model.localeCompare(b.model);
  });
});

const isEmpty = computed(() => allSnapshots.value.length === 0);

function onBackdropClick(): void {
  emit("close");
}

function onEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    emit("close");
  }
}

function selectSnapshot(snap: ProviderQuotaSnapshot): void {
  emit("select", snap);
}

/**
 * formatReset — human-readable countdown for rate-limit windows.
 * Renders as "N%" or "N% · resets Xm" when a future reset time is
 * known. Falls back to "—" when tightestPercentRemaining < 0 (the -1
 * no-signal sentinel).
 */
function formatRateLimit(pct: number, resetIso: string): string {
  if (pct < 0) return "—";
  const pctLabel = `${pct}%`;
  const reset = formatResetCountdown(resetIso);
  if (reset === "") return pctLabel;
  return `${pctLabel} · resets ${reset}`;
}

function formatResetCountdown(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffMs = t - Date.now();
  if (diffMs <= 0) return "";
  const totalSeconds = Math.round(diffMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes.toString().padStart(2, "0")}`;
}

function formatMoney(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2);
  switch (currency) {
    case "USD":
      return `$${major}`;
    case "CNY":
      return `¥${major}`;
    case "GBP":
      return `£${major}`;
    case "EUR":
      return `€${major}`;
    default:
      return `${currency} ${major}`;
  }
}

function formatTokenSpend(snap: ProviderQuotaSnapshot): string {
  const ts = snap.tokenSpend;
  if (ts === null) return "—";
  const spent = formatMoney(ts.spentMinor, ts.spentCurrency);
  if (ts.capMinor <= 0) return spent;
  const cap = formatMoney(ts.capMinor, ts.capCurrency || ts.spentCurrency);
  return `${spent} / ${cap}`;
}

/**
 * statusClass — css class suffix for the status badge colour.
 *   healthy    → green  (default)
 *   rate_limited → amber
 *   exhausted    → red
 *   spent        → amber (approaching / at cap)
 *   ""           → neutral (not_configured / unknown)
 */
function statusClass(status: string): string {
  if (status === "healthy") return "summary-status--healthy";
  if (status === "rate_limited") return "summary-status--rate-limited";
  if (status === "exhausted") return "summary-status--exhausted";
  if (status === "spent") return "summary-status--spent";
  return "summary-status--neutral";
}

function variantIcon(variant: string): string {
  if (variant === "rate_limit") return "⊡";
  if (variant === "token_spend") return "$";
  return "—";
}
</script>

<template>
  <div
    v-if="open"
    ref="modalEl"
    class="summary-backdrop"
    data-testid="provider-quota-summary-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="summary-title"
    @click.self="onBackdropClick"
    @keydown="onEscape"
    tabindex="-1"
  >
    <div class="summary-panel" data-testid="provider-quota-summary-panel">
      <header class="summary-header">
        <h2 id="summary-title" class="summary-title">Provider Quota Overview</h2>
        <button
          type="button"
          class="summary-close"
          data-testid="provider-quota-summary-close"
          aria-label="Close"
          @click="emit('close')"
        >
          &times;
        </button>
      </header>

      <div v-if="isEmpty" class="summary-empty" data-testid="provider-quota-summary-empty">
        No quota data yet. The first response will populate provider quota snapshots.
      </div>

      <table
        v-else
        class="summary-table"
        data-testid="provider-quota-summary-table"
      >
        <thead>
          <tr>
            <th class="summary-col-provider">Provider</th>
            <th class="summary-col-model">Model</th>
            <th class="summary-col-status">Status</th>
            <th class="summary-col-metric">Key Metric</th>
            <th class="summary-col-period">Reset / Period</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(snap, idx) in allSnapshots"
            :key="snapshotKey(snap.provider, snap.accountHash, snap.model)"
            class="summary-row"
            :class="{ 'summary-row--clickable': snap.variant !== 'not_configured' }"
            data-testid="provider-quota-summary-row"
            :data-provider="snap.provider"
            :data-model="snap.model"
            :data-variant="snap.variant"
            :data-status="snap.status"
            @click="selectSnapshot(snap)"
          >
            <td class="summary-cell" data-testid="summary-cell-provider">
              <span class="summary-variant-icon">{{ variantIcon(snap.variant) }}</span>
              {{ snap.provider }}
            </td>
            <td class="summary-cell summary-cell--mono" data-testid="summary-cell-model">
              {{ snap.model }}
            </td>
            <td class="summary-cell" data-testid="summary-cell-status">
              <span
                class="summary-status-badge"
                :class="statusClass(snap.status)"
                data-testid="summary-status-badge"
              >
                {{ snap.status || "—" }}
              </span>
            </td>
            <td class="summary-cell summary-cell--mono" data-testid="summary-cell-metric">
              <template v-if="snap.variant === 'rate_limit' && snap.rateLimit !== null">
                {{ formatRateLimit(snap.rateLimit.tightestPercentRemaining, snap.rateLimit.tightestResetAt) }}
              </template>
              <template v-else-if="snap.variant === 'token_spend'">
                {{ formatTokenSpend(snap) }}
              </template>
              <template v-else-if="snap.variant === 'not_configured' && snap.notConfigured !== null">
                <span
                  class="summary-not-configured"
                  :title="snap.notConfigured.reason"
                >
                  Not configured
                </span>
              </template>
            </td>
            <td class="summary-cell summary-cell--mono summary-cell--muted" data-testid="summary-cell-period">
              <template v-if="snap.variant === 'rate_limit' && snap.rateLimit !== null">
                {{ formatResetCountdown(snap.rateLimit.tightestResetAt) || "—" }}
              </template>
              <template v-else-if="snap.variant === 'token_spend' && snap.tokenSpend !== null">
                {{ snap.tokenSpend.period }}
              </template>
              <template v-else>
                —
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.summary-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.summary-panel {
  background: var(--bg-secondary, #1a1b26);
  color: var(--text-primary, #f5f5f5);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius, 8px);
  padding: 1.5rem;
  width: min(720px, 92vw);
  max-height: 80vh;
  overflow-y: auto;
  position: relative;
}

.summary-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.summary-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.summary-close {
  background: transparent;
  border: none;
  color: var(--text-muted, #b0b0b0);
  font-size: 1.4rem;
  cursor: pointer;
  padding: 0 0.3rem;
  line-height: 1;
}

.summary-close:hover {
  color: var(--text-primary, #f5f5f5);
}

.summary-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-muted, #b0b0b0);
  font-size: 0.85rem;
}

.summary-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.summary-table th {
  text-align: left;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  font-weight: 500;
  color: var(--text-secondary, #d0d0d0);
  white-space: nowrap;
}

.summary-table td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.05));
}

.summary-row {
  transition: background 0.1s ease;
}

.summary-row--clickable {
  cursor: pointer;
}

.summary-row--clickable:hover {
  background: rgba(255, 255, 255, 0.04);
}

.summary-cell {
  vertical-align: middle;
}

.summary-cell--mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.8rem;
}

.summary-cell--muted {
  color: var(--text-muted, #b0b0b0);
}

.summary-col-provider {
  width: 18%;
}

.summary-col-model {
  width: 24%;
}

.summary-col-status {
  width: 12%;
}

.summary-col-metric {
  width: 28%;
}

.summary-col-period {
  width: 18%;
}

.summary-variant-icon {
  display: inline-block;
  width: 1.2rem;
  color: var(--text-muted, #b0b0b0);
  font-weight: 600;
}

.summary-status-badge {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: var(--radius, 4px);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.summary-status--healthy {
  background: color-mix(in srgb, var(--success, #22c55e) 15%, transparent);
  color: var(--success, #22c55e);
}

.summary-status--rate-limited {
  background: color-mix(in srgb, var(--warning, #f59e0b) 15%, transparent);
  color: var(--warning, #f59e0b);
}

.summary-status--exhausted {
  background: color-mix(in srgb, var(--error, #dc2626) 18%, transparent);
  color: var(--error, #dc2626);
}

.summary-status--spent {
  background: color-mix(in srgb, var(--warning, #f59e0b) 15%, transparent);
  color: var(--warning, #f59e0b);
}

.summary-status--neutral {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted, #b0b0b0);
}

.summary-not-configured {
  cursor: help;
  border-bottom: 1px dashed var(--text-muted, #b0b0b0);
}
</style>
