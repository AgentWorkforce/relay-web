// The Sessions page's Session intelligence view: one read of the session read
// API's GET /v1/session-intel/workspace (contract `session-intel-workspace/1`).
// Off unless the runtime config sets `sessionIntel: true`
// (DASHBOARD_SESSION_INTEL_ENABLED=true); when off, nothing is requested.
import { z } from "zod";
import { ReadApiUnavailable, readApiEnabled, readApiGet } from "./read-api";

const nullableString = z.string().nullable();
const sessionRefSchema = z.object({ source: z.string(), sessionId: z.string() });

export const sessionIntelAlertSchema = z.object({
  advisoryId: z.string(),
  urgency: z.enum(["high", "low"]),
  kind: z.string(),
  // The taxonomy's classes; a kind without one is null. Kept as a string so a
  // class added later shows as unclassified instead of failing the view.
  class: nullableString,
  artifact: z.string(),
  // Two for a pair; the read API sends up to four for a planned-fleet conflict.
  sessions: z.array(sessionRefSchema),
  createdAt: z.string(),
  deliveredAt: nullableString,
  acked: z.array(sessionRefSchema.extend({ acked: z.boolean() })),
  evidence: z.array(
    z.object({
      sessionId: z.string(),
      eventId: z.string(),
      ts: z.string(),
      kind: z.string(),
    }),
  ),
});

const sessionCardSchema = z.object({
  source: z.string(),
  sessionId: z.string(),
  title: nullableString,
  shortSummary: nullableString,
  summaryAt: nullableString,
  state: z.string(),
  lastActivityAt: z.string(),
  openIntents: z.array(z.string()),
  hasClaims: z.boolean().nullable(),
});

export const sessionIntelResponseSchema = z.object({
  contract: z.literal("session-intel-workspace/1"),
  alerts: z.array(sessionIntelAlertSchema),
  status: z.array(sessionCardSchema.extend({ projectId: nullableString })),
  handoffs: z.array(sessionCardSchema.extend({ decisions: z.array(z.string()) })),
  coverage: z.object({
    sessionsActive: z.number().nonnegative(),
    sessionsWithSummary: z.number().nonnegative(),
    sessionsWithClaims: z.number().nonnegative().nullable(),
    claimsNewestAt: nullableString,
    summariesNewestAt: nullableString,
    // "unknown" or "off" today; anything but "on" is shown as not running.
    claimsExtraction: z.string(),
    notes: z.array(z.string()),
  }),
  nextCursor: z.null(),
});

export type SessionIntelAlert = z.infer<typeof sessionIntelAlertSchema>;
export type SessionIntelResponse = z.infer<typeof sessionIntelResponseSchema>;
export type SessionIntelStatus = SessionIntelResponse["status"][number];
export type SessionIntelHandoff = SessionIntelResponse["handoffs"][number];
export type SessionIntelCoverage = SessionIntelResponse["coverage"];

/** Strict boolean opt-in; missing or malformed runtime values stay off. */
export const sessionIntelViewEnabled = () =>
  typeof window !== "undefined" &&
  window.__AGENT_RELAY_DASHBOARD_CONFIG__?.sessionIntel === true;

/**
 * The workspace view, or null when the view is off here or the read API
 * answers 501 (not served by that backend: the route's flag is off, its
 * migration isn't applied, or the workspace isn't enabled). Other failures
 * reach the panel.
 */
export async function sessionIntelWorkspace(
  workspace: string,
  signal: AbortSignal,
): Promise<SessionIntelResponse | null> {
  if (!sessionIntelViewEnabled() || !readApiEnabled()) return null;
  try {
    const body = await readApiGet(
      workspace,
      "/v1/session-intel/workspace",
      {},
      signal,
    );
    return sessionIntelResponseSchema.parse(body);
  } catch (error) {
    if (error instanceof ReadApiUnavailable && error.reason === "read_501")
      return null;
    throw error;
  }
}
