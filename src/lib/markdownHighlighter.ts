/**
 * Shiki-based syntax highlighter for MarkdownRenderer fenced code blocks.
 *
 * B1 (Vue UI Parity vs OpenCode, May 2026). Pre-fix the MarkdownIt
 * instance had no `highlight` callback. This module supplies one
 * backed by Shiki, lazy-loaded so the initial JS bundle stays under
 * the 300 KB cap from the PR brief.
 *
 * N3 (May 2026 UI Parity PR4 — theme polish). Tokens carry CSS
 * variables (`--shiki-<key>`) via Shiki's multi-theme mode with
 * `defaultColor: false`, and `themes.css` picks which `--shiki-<key>`
 * is active per theme via `[data-theme="X"] .shiki span { … }`.
 * Toggling the theme re-paints existing code without re-tokenisation.
 *
 * Fully-lazy strategy (perf, Sep 2026)
 * ------------------------------------
 * A headless perf audit found ~500 KB of decoded grammars + themes
 * (typescript, javascript, go, python grammars; vitesse-light,
 * tokyo-night, dracula themes) fetched EAGERLY at initial /chat load,
 * pinning the main thread ~2.2s after paint. The loader is now
 * demand-driven:
 *
 * - `ensureHighlighterLoaded()` loads ONLY Shiki core + the JS regex
 *   engine + the theme currently active on `<html data-theme>`
 *   (default `dark`). Zero grammars, zero sibling themes.
 * - The FIRST time `highlightCode()` sees a fence whose language maps
 *   to a supported grammar, that single grammar is dynamically
 *   imported, registered, and the ready listeners fire so components
 *   re-render the now-tokenisable block. Loaded grammars are cached.
 * - Additional themes load on demand: a MutationObserver on
 *   `<html>`'s `data-theme` attribute triggers `loadTheme()` for the
 *   newly-active palette, then fires the ready listeners to
 *   re-tokenise with the wider variable set.
 * - Until a grammar/theme resolves, `highlightCode()` returns `null`
 *   and the fence renderer falls back to plain `<pre><code>` — the
 *   same graceful contract as before.
 *
 * Bundle weight
 * -------------
 * Initial JS bundle carries only the module shim (a few bytes). Each
 * grammar (~15–60 KB decoded) and theme (~2 KB) is its own dynamic
 * import, so Vite emits one small chunk per language/theme fetched
 * exactly when first needed.
 *
 * Synchronous fence callback
 * --------------------------
 * MarkdownIt's `highlight` option is sync. After a grammar is loaded,
 * the cached highlighter satisfies that contract via `codeToHtml`.
 * Before load, the callback signals failure with `null` and the fence
 * renderer falls back to plain `<pre><code>`.
 *
 * Graceful fallback
 * -----------------
 * Unknown languages, plain fences, or any Shiki error degrades to
 * the caller's plain fallback. Failure is silent — the bubble keeps
 * rendering.
 */
import { ref } from "vue";
import type {
  HighlighterCore,
  ThemeRegistration,
} from "@shikijs/core";

// Dynamically importable grammar factories, keyed by the canonical
// Shiki grammar name. NOTE: each @shikijs/langs/* module's default
// export is an ARRAY of registrations (many grammars bundle several
// embedded registrations), so the resolved type is loose here.
// Membership check before calling Shiki avoids surfacing
// "Language not loaded" errors from inside the highlight callback.
const LANG_IMPORTS: Record<string, () => Promise<unknown>> = {
  bash: async () => (await import("@shikijs/langs/bash")).default,
  javascript: async () => (await import("@shikijs/langs/javascript")).default,
  typescript: async () => (await import("@shikijs/langs/typescript")).default,
  markdown: async () => (await import("@shikijs/langs/markdown")).default,
  powershell: async () =>
    (await import("@shikijs/langs/powershell")).default,
  zig: async () => (await import("@shikijs/langs/zig")).default,
  json: async () => (await import("@shikijs/langs/json")).default,
  go: async () => (await import("@shikijs/langs/go")).default,
  python: async () => (await import("@shikijs/langs/python")).default,
};

const SUPPORTED_LANGS = new Set(Object.keys(LANG_IMPORTS));

// Theme factories keyed by FlowState `data-theme` keys. Each key MUST
// match a `[data-theme="<key>"]` selector in `themes.css` so the CSS
// rule `[data-theme="X"] .shiki span { color: var(--shiki-X); }` can
// pick the right per-token variable.
//
// Mapping rationale:
//   - dark:             vitesse-dark    (FlowState's original mark)
//   - light:            vitesse-light   (sibling palette, same family)
//   - terminal:         solarized-dark  (warm-toned amber/green that
//                                        reads on a CRT-style chassis)
//   - tokyo-night:      tokyo-night     (canonical mapping)
//   - catppuccin-mocha: catppuccin-mocha (canonical mapping)
//   - dracula:          dracula         (canonical mapping)
//   - nord:             nord            (canonical mapping)
const THEME_IMPORTS: Record<string, () => Promise<ThemeRegistration>> = {
  dark: async () => (await import("@shikijs/themes/vitesse-dark")).default,
  light: async () => (await import("@shikijs/themes/vitesse-light")).default,
  terminal: async () =>
    (await import("@shikijs/themes/solarized-dark")).default,
  "tokyo-night": async () =>
    (await import("@shikijs/themes/tokyo-night")).default,
  "catppuccin-mocha": async () =>
    (await import("@shikijs/themes/catppuccin-mocha")).default,
  dracula: async () => (await import("@shikijs/themes/dracula")).default,
  nord: async () => (await import("@shikijs/themes/nord")).default,
};

// Alias map — accept the common shorthand spellings users type in
// fences. Shiki only matches the canonical grammar names so we
// normalise here.
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  ps: "powershell",
  ps1: "powershell",
  md: "markdown",
  py: "python",
  golang: "go",
};

let highlighter: HighlighterCore | null = null;
let loadPromise: Promise<HighlighterCore> | null = null;
const readyListeners = new Set<() => void>();

// Race-free re-render signal. The legacy onHighlighterReady listener
// pulse can fire BEFORE a component's onMounted subscribes (the core
// load may resolve in the same microtask turn that precedes mount),
// silently losing the notification. This module-level reactive
// counter removes the registration race entirely: components read
// `highlighterVersionRef.value` inside their render computeds, so any
// increment — whenever it happens relative to mount — re-evaluates
// them. Bumped on every completed resource load (core created,
// grammar registered, theme loaded).
export const highlighterVersionRef = ref(0);

/** Getter form for non-reactive call sites. */
export function getHighlighterVersion(): number {
  return highlighterVersionRef.value;
}

function bumpVersion(): void {
  highlighterVersionRef.value += 1;
}

// Grammar cache — populated on demand by ensureLangLoaded().
const loadedLangs = new Set<string>();
const langPromises = new Map<string, Promise<void>>();

// Theme cache — starts with only the palette active at load time;
// further entries are added by the data-theme MutationObserver.
const loadedThemes = new Set<string>();
const themePromises = new Map<string, Promise<void>>();

let themeObserver: MutationObserver | null = null;

// Grammars requested before the core highlighter finished loading —
// replayed (as on-demand loads) the moment the core resolves so the
// first fence of a language never gets silently dropped.
const pendingLangs = new Set<string>();

/**
 * The FlowState theme key currently active on `<html data-theme>`.
 * Falls back to `dark` outside the browser / on unknown values.
 */
function activeThemeKey(): string {
  if (typeof document === "undefined") return "dark";
  const value = document.documentElement.getAttribute("data-theme");
  if (value !== null && value in THEME_IMPORTS) return value;
  return "dark";
}

/**
 * Re-render pulse. Every completed on-demand load (grammar or theme)
 * fires the ready listeners so mounted components bump their
 * highlighter version and re-tokenise. Listener errors must not block
 * other subscribers — swallow.
 */
function notifyReady(): void {
  // Reactive path FIRST — this is the race-free mechanism components
  // rely on. Listener errors must not block other subscribers.
  bumpVersion();
  const snap = Array.from(readyListeners);
  snap.forEach((fn) => {
    try {
      fn();
    } catch {
      // swallow — see above
    }
  });
}

/**
 * Resolve a fence-info language tag to a supported Shiki grammar
 * name, or `null` if unsupported. Strips whitespace and lower-cases
 * to match how Shiki's bundled grammar names are spelled.
 */
function resolveLang(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === "") return null;
  const mapped = LANG_ALIASES[cleaned] ?? cleaned;
  if (!SUPPORTED_LANGS.has(mapped)) return null;
  return mapped;
}

/**
 * Register a grammar with the highlighter, loading it on first use.
 * Memoised per language so concurrent fences share one import. When
 * registration completes the ready listeners fire — components
 * re-render and the triggering block gets tokenised on the next
 * paint. No-ops if the core highlighter is not yet up (the grammar
 * will be requested again on the next highlightCode call).
 */
export function ensureLangLoaded(lang: string): Promise<void> {
  const grammar = resolveLang(lang);
  if (grammar === null) return Promise.resolve();
  const pending = langPromises.get(grammar);
  if (pending !== undefined) return pending;
  if (loadedLangs.has(grammar)) return Promise.resolve();
  if (highlighter === null) {
    // Core not up yet — stash the request; the core loader replays
    // it right after creation (see ensureHighlighterLoaded).
    pendingLangs.add(grammar);
    return Promise.resolve();
  }
  const promise = LANG_IMPORTS[grammar]()
    .then((registration) =>
      // The highlighter is non-null for the whole life of this
      // promise chain (only ever assigned once, before any grammar
      // load is initiated). loadLanguage is ASYNC — registration
      // lands in a microtask — so we must await it BEFORE firing
      // notifyReady; otherwise the re-render races ahead of the
      // registry and codeToHtml throws "Language not found".
      // (NOTE: @shikijs/langs/* default exports are ARRAYS of
      // registrations; loadLanguage accepts the array directly.)
      highlighter!.loadLanguage(registration as Parameters<
        HighlighterCore["loadLanguage"]
      >[0]),
    )
    .then(() => {
      loadedLangs.add(grammar);
      notifyReady();
    })
    .catch(() => {
      // Import or registration failure — drop the memo so a later
      // fence can retry, and keep the plain-fallback contract.
      langPromises.delete(grammar);
    });
  langPromises.set(grammar, promise);
  return promise;
}

/**
 * Register a FlowState theme with the highlighter, loading it on
 * demand. The Shiki theme is re-named to the FlowState key so the
 * token CSS-variable shape is `--shiki-dark`, `--shiki-light`, etc.
 * (the original Shiki name would otherwise leak through as
 * `--shiki-vitesse-dark`). Memoised per theme.
 */
export function loadTheme(key: string): Promise<void> {
  if (!(key in THEME_IMPORTS)) return Promise.resolve();
  const pending = themePromises.get(key);
  if (pending !== undefined) return pending;
  if (highlighter === null) return Promise.resolve();
  const promise = THEME_IMPORTS[key]()
    .then((registration) => {
      highlighter!.loadTheme({
        ...(registration as Record<string, unknown>),
        name: key,
      });
      loadedThemes.add(key);
      notifyReady();
    })
    .catch(() => {
      themePromises.delete(key);
    });
  themePromises.set(key, promise);
  return promise;
}

/**
 * Kick off the lazy Shiki load. Loads ONLY Shiki core, the JS regex
 * engine, and the currently-active theme — no grammars, no sibling
 * themes. Returns a Promise that resolves when the core highlighter
 * is ready. Idempotent — concurrent calls share the same Promise.
 * Callers do not need to await this; the module re-renders
 * subscribers via `onHighlighterReady` once loading completes.
 */
export function ensureHighlighterLoaded(): Promise<HighlighterCore> {
  if (highlighter !== null) return Promise.resolve(highlighter);
  if (loadPromise !== null) return loadPromise;

  const initialTheme = activeThemeKey();

  loadPromise = (async (): Promise<HighlighterCore> => {
    const [{ createHighlighterCoreSync }, { createJavaScriptRegexEngine }, theme] =
      await Promise.all([
        import("@shikijs/core"),
        import("@shikijs/engine-javascript"),
        THEME_IMPORTS[initialTheme](),
      ]);

    const created = createHighlighterCoreSync({
      // Re-name the active theme to the FlowState data-theme key (see
      // loadTheme for the rationale). Only the active palette ships
      // here — sibling themes load on demand via the data-theme
      // MutationObserver wired below.
      themes: [
        { ...(theme as Record<string, unknown>), name: initialTheme },
      ],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
    highlighter = created;
    loadedThemes.add(initialTheme);

    // Replay any grammar requested before the core resolved — those
    // early highlightCode calls stashed their languages in
    // pendingLangs instead of no-opping. Draining here guarantees
    // the first fence of a language still gets tokenised.
    if (pendingLangs.size > 0) {
      const drained = Array.from(pendingLangs);
      pendingLangs.clear();
      drained.forEach((grammar) => {
        void ensureLangLoaded(grammar);
      });
    }

    // Watch for theme switches — when the user picks a palette that
    // has not been loaded yet, fetch just that theme and re-tokenise.
    if (
      typeof MutationObserver !== "undefined" &&
      typeof document !== "undefined" &&
      themeObserver === null
    ) {
      themeObserver = new MutationObserver((records) => {
        const changed = records.some(
          (r) => r.attributeName === "data-theme",
        );
        if (!changed) return;
        void loadTheme(activeThemeKey());
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    }

    notifyReady();
    return created;
  })();

  return loadPromise;
}

/**
 * Subscribe to highlighter-ready notifications. The listener fires
 * every time an on-demand load completes (core, grammar, or theme) so
 * mounted components can bump their version counter and re-render.
 * Returns a cleanup function the caller must invoke on unmount.
 */
export function onHighlighterReady(fn: () => void): () => void {
  // Idempotent subscription — re-registering an already-registered
  // listener is a no-op so repeated mount cycles cannot stack pulses.
  readyListeners.add(fn);
  return () => {
    readyListeners.delete(fn);
  };
}

/**
 * Tokenise `code` as `lang`, returning Shiki's `<pre class="shiki …">`
 * HTML. Returns `null` if:
 *
 *   - The core highlighter or the language's grammar has not finished
 *     loading yet (the missing piece is requested as a side effect;
 *     once it lands the caller is notified via `onHighlighterReady`
 *     and re-renders).
 *   - The language is not in the supported set.
 *   - Any Shiki tokenisation error occurs.
 */
export function highlightCode(code: string, lang: string): string | null {
  if (highlighter === null) {
    // Core not up yet — record the requested grammar so
    // ensureHighlighterLoaded drains it the moment the core resolves
    // (see pendingLangs), then fall back for THIS paint.
    void ensureLangLoaded(lang);
    return null;
  }
  const grammar = resolveLang(lang);
  if (grammar === null) return null;
  if (!loadedLangs.has(grammar)) {
    // Demand-driven load — first fence of this language pulls exactly
    // one grammar chunk. Returns null THIS paint; the ready pulse
    // triggers the tokenised re-paint.
    void ensureLangLoaded(grammar);
    return null;
  }
  try {
    // N3 — multi-theme mode over the themes loaded so far (starts
    // with only the active palette; grows as the user switches).
    // `defaultColor: false` tells Shiki NOT to pick one theme as the
    // inline `color:` value; instead each token ships a bundle of
    // `--shiki-<key>` CSS variables, and the active value is resolved
    // via `themes.css`.
    const themes: Record<string, string> = {};
    loadedThemes.forEach((key) => {
      themes[key] = key;
    });
    return highlighter.codeToHtml(code, {
      lang: grammar,
      themes,
      defaultColor: false,
    });
  } catch {
    return null;
  }
}
