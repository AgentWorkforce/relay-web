// A typed browser port to Control's authenticated gateway. The server chooses
// collector or PostHog and derives attribution from the existing cookie. This
// process never receives a producer credential and never stores event bodies.
import { analyticsEnabled } from "./app-path";

export type AnalyticsPage = "sessions" | "agents" | "overview" | "workflows" | "flows" | "settings" | "members" | "device";
export type SessionOpenSource = "list" | "search" | "link";
type Input =
  | { event: "dashboard.page_viewed"; properties: { page: AnalyticsPage } }
  | { event: "dashboard.session_opened"; properties: { source: SessionOpenSource } };
type Queued = { input: Input; id: string; occurred: string; deadline: number; attempts: number };
type Counts = { queued: number; gatewayAccepted: number; dropped: number };
const PAGES: readonly string[] = ["sessions", "agents", "overview", "workflows", "flows", "settings", "members", "device"];
const SOURCES: readonly string[] = ["list", "search", "link"];
const ENDPOINT = "/cloud/api/v1/analytics/events";
const MAX_QUEUE = 32;
const DEADLINE_MS = 20_000;
const REQUEST_MS = 3_000;
const MAX_ATTEMPTS = 3;

function eventId(): string {
  // randomUUID is secure-context-only; getRandomValues is also available on
  // HTTP self-hosted sites. Never fall back to Math.random or a user identity.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Project again at the runtime boundary: even an untyped caller cannot export
// an arbitrary property, URL, session id, query, transcript or exception.
function project(value: Input): Input | null {
  if (value?.event === "dashboard.page_viewed" && PAGES.includes(value.properties?.page))
    return { event: value.event, properties: { page: value.properties.page } };
  if (value?.event === "dashboard.session_opened" && SOURCES.includes(value.properties?.source))
    return { event: value.event, properties: { source: value.properties.source } };
  return null;
}

export function createAnalytics(options: {
  enabled: () => boolean;
  fetch?: typeof fetch;
  now?: () => number;
  uuid?: () => string;
}) {
  const send = options.fetch ?? ((...args) => fetch(...args));
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? eventId;
  let context: string | null = null;
  let generation = 0;
  let refused = false;
  let active: { abort: AbortController; item: Queued } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const queue: Queued[] = [];
  const counts = { gatewayAccepted: 0, dropped: 0 };

  function clear() {
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    active?.abort.abort();
    active = null;
    counts.dropped += queue.length;
    queue.length = 0;
  }
  function setContext(value: string | null) {
    if (context === value && options.enabled()) return;
    clear();
    context = options.enabled() ? value : null;
    refused = false;
  }
  function schedule(delay: number) {
    if (timer !== null || active || !queue.length) return;
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  }
  async function flush() {
    if (active || !queue.length) return;
    if (!options.enabled() || !context) { clear(); return; }
    const item = queue[0]!;
    if (now() >= item.deadline) {
      queue.shift(); counts.dropped += 1; schedule(0); return;
    }
    const epoch = generation;
    const abort = new AbortController();
    active = { abort, item };
    const timeout = setTimeout(() => abort.abort(), Math.min(REQUEST_MS, item.deadline - now()));
    item.attempts += 1;
    let status = 0;
    let retryMs = 500 * item.attempts;
    try {
      const response = await send(ENDPOINT, {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        signal: abort.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: "agent-relay.analytics.client-batch/v1", client: "dashboard", events: [{ ...item.input, occurred_at: item.occurred, client_event_id: item.id }] }),
      });
      status = response.status;
      const retry = response.headers.get("Retry-After");
      if (retry && /^\d+$/.test(retry)) retryMs = Math.min(5_000, Math.max(500, Number(retry) * 1_000));
      // Neither response bodies nor error text are needed or retained.
      await response.body?.cancel();
    } catch { /* Bounded retry; never reject a page operation or report its data. */ }
    finally { clearTimeout(timeout); }
    if (epoch !== generation) return;
    active = null;
    if (!options.enabled()) { clear(); return; }
    if (status === 202) {
      counts.gatewayAccepted += 1; queue.shift(); schedule(0); return;
    }
    if (status === 401 || status === 403 || status === 404) {
      // Sign-out, CSRF/authority refusal, or a disabled server gateway. Only a
      // new authenticated context can reopen it; never hammer these routes.
      clear(); refused = true; return;
    }
    const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
    if (!retryable || item.attempts >= MAX_ATTEMPTS || now() + retryMs >= item.deadline) {
      queue.shift(); counts.dropped += 1; schedule(0); return;
    }
    schedule(retryMs);
  }
  function capture(value: Input) {
    if (!options.enabled()) { clear(); return; }
    const input = project(value);
    if (!context || refused || !input || queue.length >= MAX_QUEUE) { counts.dropped += 1; return; }
    try {
      const at = now();
      queue.push({ input, id: uuid(), occurred: new Date(at).toISOString(), deadline: at + DEADLINE_MS, attempts: 0 });
      schedule(0);
    } catch { counts.dropped += 1; }
  }
  return {
    setContext, capture,
    stop() { clear(); context = null; refused = false; },
    stats(): Counts { return { ...counts, queued: queue.length }; },
  };
}

export const analytics = createAnalytics({ enabled: analyticsEnabled });
