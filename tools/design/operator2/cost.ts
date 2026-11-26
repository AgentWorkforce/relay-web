// Dollar amounts next to tokens, as Khaliq asked. The fixtures record tokens but no cost, so cost is an
// estimate: tokens × a blended price per million for the model a session ran. Shown as "est." wherever
// it appears – a real price list (or the provider's reported cost) replaces this table.
//
// By default a session's model follows its harness (Claude Code → Claude Sonnet, Codex → GPT-5 Codex …).
// The "many" data set gives sessions their own models from the wider catalogue below, to design for a
// team that uses ten or twenty of them.
import type { Overview, SessionItem } from "../operator/model";

/** `icon` is the logo shown for the model's maker (a harness icon file: claude, chatgpt, gemini, grok, opencode, cursor) */
export type Model = { name: string; perMillion: number; icon: string };

export const MODEL_CATALOGUE: Model[] = [
  { name: "Claude Opus", perMillion: 30, icon: "claude" },
  { name: "Claude Sonnet", perMillion: 6, icon: "claude" },
  { name: "Claude Haiku", perMillion: 1.6, icon: "claude" },
  { name: "GPT-5", perMillion: 5.6, icon: "chatgpt" },
  { name: "GPT-5 Codex", perMillion: 4, icon: "chatgpt" },
  { name: "GPT-5 mini", perMillion: 1.1, icon: "chatgpt" },
  { name: "o4-mini", perMillion: 2.2, icon: "chatgpt" },
  { name: "Gemini 2.5 Pro", perMillion: 5, icon: "gemini" },
  { name: "Gemini 2.5 Flash", perMillion: 1, icon: "gemini" },
  { name: "Grok 4", perMillion: 6, icon: "grok" },
  { name: "Grok Code Fast", perMillion: 0.6, icon: "grok" },
  { name: "Kimi K2", perMillion: 1.2, icon: "opencode" },
  { name: "DeepSeek V3", perMillion: 0.6, icon: "opencode" },
  { name: "Qwen3 Coder", perMillion: 0.9, icon: "opencode" },
  { name: "GLM-4.6", perMillion: 0.8, icon: "opencode" },
  { name: "Llama 4 Maverick", perMillion: 0.5, icon: "opencode" },
  { name: "Mistral Large", perMillion: 3, icon: "opencode" },
  { name: "Devstral", perMillion: 0.4, icon: "opencode" },
  { name: "Cursor Composer", perMillion: 3, icon: "cursor" },
  { name: "Cursor Auto", perMillion: 5, icon: "cursor" },
];
const byName = (name: string) => MODEL_CATALOGUE.find((m) => m.name === name)!;

const BY_HARNESS: Record<string, Model> = {
  claude: byName("Claude Sonnet"),
  codex: byName("GPT-5 Codex"),
  cursor: byName("Cursor Auto"),
  opencode: byName("Kimi K2"),
  gemini: byName("Gemini 2.5 Pro"),
};
const FALLBACK: Model = { name: "Unknown model", perMillion: 5, icon: "opencode" };

/** Sessions the "many" data set gave a model of their own (session id → model) */
const OWN_MODEL = new Map<string, Model>();
export function setModel(sessionId: string, model: Model) {
  OWN_MODEL.set(sessionId, model);
}

/** A session's main model – the one it was started with */
export const modelOf = (s: SessionItem) => OWN_MODEL.get(s.id) ?? BY_HARNESS[s.source] ?? FALLBACK;

/**
 * The cheaper model a harness hands side work to – Claude Code runs Haiku for searches and summaries,
 * Codex a mini model, and so on. Roughly a fifth of a session's tokens go there.
 */
const HELPER: Record<string, string> = {
  claude: "Claude Haiku",
  chatgpt: "GPT-5 mini",
  gemini: "Gemini 2.5 Flash",
  grok: "Grok Code Fast",
};

/** One stretch of a session's work: when, on which model, how many tokens, what it cost */
export type Usage = { t: number; model: Model; tokens: number; cost: number };

const seeded = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const hashOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const USAGE = new Map<string, Usage[]>();

/**
 * When a session spent its tokens. The data records a session's total only, so it's spread over the
 * session's runtime in turns of about ten minutes – unevenly, as real work goes: most turns are small,
 * some read a lot of code or run long tool chains and cost several times as much. Part of each turn
 * goes to the harness's helper model.
 */
export function usageOf(s: SessionItem): Usage[] {
  if (s.tokens === null || s.tokens <= 0) return [];
  const key = `${s.id}|${s.tokens}|${s.firstTs}|${s.lastTs}|${modelOf(s).name}`;
  const kept = USAGE.get(key);
  if (kept) return kept;
  const h = hashOf(s.id);
  const start = Date.parse(s.firstTs);
  const end = Math.max(start + 10 * 60_000, Date.parse(s.lastTs));
  const turns = Math.min(60, Math.max(3, Math.round((end - start) / (10 * 60_000))));
  const weights = Array.from({ length: turns }, (_, k) => {
    const r = seeded(h + k * 7);
    return r > 0.88 ? 4 + r * 6 : 0.3 + r; // now and then a heavy turn
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  const main = modelOf(s);
  const helperName = HELPER[main.icon];
  const helper = helperName && helperName !== main.name ? byName(helperName) : null;
  const out: Usage[] = [];
  weights.forEach((w, k) => {
    const t = start + ((k + 0.5) / turns) * (end - start);
    const tokens = (s.tokens! * w) / sum;
    const side = helper ? 0.1 + seeded(h + k * 13) * 0.2 : 0;
    out.push({ t, model: main, tokens: tokens * (1 - side), cost: ((tokens * (1 - side)) / 1_000_000) * main.perMillion });
    if (helper && side > 0) out.push({ t, model: helper, tokens: tokens * side, cost: ((tokens * side) / 1_000_000) * helper.perMillion });
  });
  USAGE.set(key, out);
  return out;
}

export const costOf = (s: SessionItem) => (s.tokens === null ? null : usageOf(s).reduce((a, u) => a + u.cost, 0));
export const costOfAll = (list: SessionItem[]) => {
  const known = list.map(costOf).filter((c): c is number => c !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};
export const tokensOf = (list: SessionItem[]) => {
  const known = list.filter((s) => s.tokens !== null);
  return known.length ? known.reduce((a, s) => a + s.tokens!, 0) : null;
};

export function formatUSD(n: number | null) {
  if (n === null) return "–";
  if (n < 10) return `$${n.toFixed(2)}`;
  if (n < 1000) return `$${n.toFixed(0)}`;
  return `$${(n / 1000).toFixed(1)}k`;
}

/** All sessions of the period – from the tasks, or the projects when there is no current analysis */
export const allSessions = (data: Overview) => (data.initiatives.length ? data.initiatives.flatMap((i) => i.sessions) : data.projects.flatMap((p) => p.sessions));
