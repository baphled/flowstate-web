<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef } from "vue";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { useQuotaStore, type ProviderQuotaSnapshot } from "@/stores/quotaStore";
import Icon from "@/components/common/Icon.vue";

/**
 * ProviderQuotaSummaryModal — modal showing the provider quota and rate
 * limit position for every provider+model pair the engine has observed.
 *
 * Reads directly from quotaStore.snapshots — no props required. The
 * modal surfaces all three variant types (rate_limit, token_spend,
 * not_configured) so the operator can see the state of every configured
 * provider in one place, not just the active session's provider+model.
 *
 * Closes on Escape, on a click outside the panel, and on the X button.
 * Focus is trapped inside the modal while open.
 */
defineOptions({ name: "ProviderQuotaSummaryModal" });

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const quotaStore = useQuotaStore();
const modalEl = ref<HTMLElement | null>(null);

useFocusTrap(modalEl, toRef(props, "open"));

/** All snapshots from the quota store, sorted by provider then model. */
const entries = computed<ProviderQuotaSnapshot[]>(() => {
  return Object.values(quotaStore.snapshots).sort((a, b) => {
    const pc = a.provider.localeCompare(b.provider);
    if (pc !== 0) return pc;
    return a.model.localeCompare(b.model);
  });
});

/** True when no snapshots have been observed yet. */
const isEmpty = computed(() => entries.value.length === 0);

/** True when the only snapshot(s) are not_configured — the engine
 *  knows about the provider but has no quota signal. */
const allNotConfigured = computed(() => {
  if (isEmpty.value) return false;
  return entries.value.every((e) => e.variant === "not_configured");
});

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && props.open) {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
  }
}

function handleBackdropClick(): void {
  emit("close");
}

function handleCloseButton(): void {
  emit("close");
}

onMounted(() => {
  document.addEventListener("keydown", handleKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeydown, true);
});

function formatMoney(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2);
  switch (currency) {
    case "USD": return `$${major}`;
    case "CNY": return `¥${major}`;
    case "GBP": return `£${major}`;
    case "EUR": return `€${major}`;
    default: return `${currency} ${major}`;
  }
}

function formatReset(iso: string): string {
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

/** Human-friendly label for a snapshot's key figure. */
function summaryLabel(snap: ProviderQuotaSnapshot): string {
  if (snap.variant === "rate_limit" && snap.rateLimit !== null) {
    const pct = snap.rateLimit.tightestPercentRemaining;
    const pctLabel = pct < 0 ? "—" : `${pct}%`;
    const reset = formatReset(snap.rateLimit.tightestResetAt);
    if (reset === "") return `${pctLabel} remaining`;
    return `${pctLabel} remaining · resets ${reset}`;
  }
  if (snap.variant === "token_spend" && snap.tokenSpend !== null) {
    const ts = snap.tokenSpend;
    const spent = formatMoney(ts.spentMinor, ts.spentCurrency);
    if (ts.capMinor <= 0) return spent;
    const cap = formatMoney(ts.capMinor, ts.capCurrency || ts.spentCurrency);
    return `${spent} / ${cap}`;
  }
  if (snap.variant === "not_configured" && snap.notConfigured !== null) {
    return snap.notConfigured.reason;
  }
  return "";
}

function severityClass(snap: ProviderQuotaSnapshot): string {
  if (snap.variant === "not_configured") return "severity-neutral";
  if (snap.variant === "rate_limit" && snap.rateLimit !== null) {
    const pct = snap.rateLimit.tightestPercentRemaining;
    if (pct < 0) return "severity-neutral";
    if (pct < 5) return "severity-danger";
    if (pct < 20) return "severity-warning";
    return "severity-neutral";
  }
  if (snap.variant === "token_spend" && snap.tokenSpend !== null) {
    const ts = snap.tokenSpend;
    if (ts.capMinor <= 0) return "severity-neutral";
    if (ts.thresholdRed >= 0 && (ts.spentMinor / ts.capMinor) * 100 >= ts.thresholdRed) return "severity-danger";
    if (ts.thresholdAmber >= 0 && (ts.spentMinor / ts.capMinor) * 100 >= ts.thresholdAmber) return "severity-warning";
    return "severity-neutral";
  }
  return "severity-neutral";
}

function variantLabel(variant: string): string {
  switch (variant) {
    case "rate_limit": return "Rate limit";
    case "token_spend": return "Spend";
    case "not_configured": return "Not configured";
    default: return variant;
  }
}
</script>

<template>
  <div
    v-if="open"
    class="quota-summary-overlay"
    data-testid="quota-summary-overlay"
    @click.self="handleBackdropClick"
  >
    <div
      ref="modalEl"
      class="quota-summary-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Provider quota summary"
      data-testid="quota-summary-panel"
    >
      <header class="quota-summary-header">
        <h2 class="quota-summary-title">Provider quota summary</h2>
        <button
          type="button"
          class="quota-summary-close"
          aria-label="Close"
          data-testid="quota-summary-close"
          @click="handleCloseButton"
        >
          <Icon name="close" :size="18" />
        </button>
      </header>

      <div class="quota-summary-body">
        <div
          v-if="isEmpty"
          class="quota-summary-empty"
          data-testid="quota-summary-empty"
        >
          <p>No provider quota data yet.</p>
          <p class="quota-summary-empty-hint">
            Send a message to populate quota information from the engine.
          </p>
        </div>

        <div
          v-else-if="allNotConfigured"
          class="quota-summary-all-nc"
          data-testid="quota-summary-all-nc"
        >
          <p>All observed providers are in a <em>not configured</em> state.</p>
          <p class="quota-summary-all-nc-hint">
            This is expected when there is no quota store configured, or when
            each provider's first response has not yet arrived.
          </p>
        </div>

        <div
          v-else
          class="quota-summary-entries"
          data-testid="quota-summary-entries"
        >
          <div
            v-for="(entry, idx) in entries"
            :key="`${entry.provider}:${entry.accountHash}:${entry.model}`"
            class="quota-summary-entry"
            :class="[severityClass(entry), {
              'entry-stale': entry.stale,
              'entry-not-configured': entry.variant === 'not_configured',
            }]"
            :data-testid="`quota-summary-entry-${idx}`"
            :data-variant="entry.variant"
            :data-severity="severityClass(entry).replace('severity-', '')"
          >
            <div class="entry-header">
              <span
                class="entry-provider"
                data-testid="entry-provider"
              >
                {{ entry.provider }}
              </span>
              <span
                class="entry-model"
                data-testid="entry-model"
              >
                {{ entry.model }}
              </span>
              <span
                class="entry-variant-badge"
                :class="`badge--${entry.variant}`"
                data-testid="entry-variant-badge"
              >
                {{ variantLabel(entry.variant) }}
              </span>
            </div>
            <div
              class="entry-summary"
              :class="{ 'entry-summary--muted': entry.variant === 'not_configured' }"
              data-testid="entry-summary"
            >
              {{ summaryLabel(entry) }}
            </div>
            <div
              v-if="entry.stale"
              class="entry-stale-tag"
              data-testid="entry-stale-tag"
            >
              Stale
            </div>
            <div
              class="entry-observed-at"
              data-testid="entry-observed-at"
            >
              Observed: {{ entry.observedAt ? new Date(entry.observedAt).toLocaleString() : "—" }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quota-summary-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  background: rgba(0, 0, 0, 0.5);
}

.quota-summary-panel {
  width: 520px;
  max-width: calc(100vw - 2rem);
  max-height: 70vh;
  background: var(--bg-primary, #1a1a2e);
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.quota-summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
}

.quota-summary-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary, #f5f5f5);
}

.quota-summary-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted, #b0b0b0);
  cursor: pointer;
}
.quota-summary-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #f5f5f5);
}

.quota-summary-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem;
}

.quota-summary-empty,
.quota-summary-all-nc {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-muted, #b0b0b0);
}

.quota-summary-empty p,
.quota-summary-all-nc p {
  margin: 0.25rem 0;
}

.quota-summary-empty-hint,
.quota-summary-all-nc-hint {
  font-size: 0.85rem;
  color: var(--text-muted, #888);
}

.quota-summary-entries {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.quota-summary-entry {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: background 0.15s;
}
.quota-summary-entry:hover {
  background: rgba(255, 255, 255, 0.06);
}

.entry-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.entry-provider {
  font-weight: 600;
  color: var(--text-primary, #f5f5f5);
  font-size: 0.9rem;
  text-transform: capitalize;
}

.entry-model {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.78rem;
  color: var(--text-muted, #b0b0b0);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-variant-badge {
  font-size: 0.7rem;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
}
.badge--rate_limit {
  background: color-mix(in srgb, var(--info, #5898d4) 15%, transparent);
  color: var(--info, #5898d4);
}
.badge--token_spend {
  background: color-mix(in srgb, var(--accent, #8b5cf6) 15%, transparent);
  color: var(--accent, #8b5cf6);
}
.badge--not_configured {
  background: color-mix(in srgb, var(--text-muted, #b0b0b0) 15%, transparent);
  color: var(--text-muted, #b0b0b0);
}

.entry-summary {
  font-size: 0.88rem;
  color: var(--text-primary, #f5f5f5);
  font-family: var(--font-mono, ui-monospace, monospace);
}
.entry-summary--muted {
  color: var(--text-muted, #b0b0b0);
  font-style: italic;
}

.entry-stale-tag {
  display: inline-block;
  font-size: 0.7rem;
  padding: 0.08rem 0.35rem;
  margin-top: 0.25rem;
  border-radius: 3px;
  background: color-mix(in srgb, var(--warning, #f0a030) 18%, transparent);
  color: var(--warning, #f0a030);
  font-weight: 500;
}

.entry-observed-at {
  font-size: 0.72rem;
  color: var(--text-muted, #888);
  margin-top: 0.3rem;
}

.quota-summary-entry.severity-warning {
  border-left: 3px solid var(--warning, #f0a030);
}
.quota-summary-entry.severity-danger {
  border-left: 3px solid var(--error, #e74c3c);
}
.quota-summary-entry.severity-neutral {
  border-left: 3px solid transparent;
}

.entry-not-configured {
  opacity: 0.7;
}
</style>
