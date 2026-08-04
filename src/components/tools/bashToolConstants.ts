/** Hard-cap the visible slice to keep &lt;pre&gt; layout cheap on the main
 *  thread; users can opt in to the full body via the "Show full output"
 *  toggle. The cap is purely visual — the agent-side truncation in
 *  internal/tool/truncate already enforces the contract the model sees. */
export const RENDER_MAX_LINES = 200;
export const RENDER_MAX_BYTES = 8 * 1024;
