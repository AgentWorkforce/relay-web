// Session access through relaycontrol (`/cloud/api/v1/workspaces/:ws/sessions/:id/access`).
// relaygate holds the policy and decides who is a session access
// administrator; Control resolves emails to members. The dashboard only shows
// the answer and sends what the person typed.
import { z } from "zod";
import { adminRequest, ApiError } from "../admin/api";

const perm = z.enum(["r", "w", "rw"]);
export type Perm = z.infer<typeof perm>;
export const PERMS: readonly Perm[] = ["r", "w", "rw"];

const grantSchema = z.union([
  z.object({
    userId: z.string(),
    email: z.string(),
    name: z.string().nullish().transform((value) => value ?? null),
    perm,
    member: z.literal(true),
  }),
  z.object({ userId: z.string(), perm, member: z.literal(false) }),
]);
export type AccessGrant = z.infer<typeof grantSchema>;

const groupSchema = z.object({ gid: z.number().int().min(0), perm });
export type AccessGroup = z.infer<typeof groupSchema>;

const policySchema = z.object({
  sessionId: z.string(),
  runtime: z.boolean(),
  reset: z.boolean().default(false),
  version: z.number().int().min(0),
  mode: z.string(),
  gid: z.number().int().nullish().transform((value) => value ?? null),
  groups: z.array(groupSchema),
  members: z.array(grantSchema),
  label: z.string().nullish().transform((value) => value ?? null),
  updatedAt: z.string().nullish().transform((value) => value ?? null),
});
export type AccessPolicy = z.infer<typeof policySchema>;

const answerSchema = z.object({ access: policySchema });

const snapshotSchema = z
  .object({
    mode: z.string().nullish().transform((value) => value ?? null),
    gid: z.number().int().nullish().transform((value) => value ?? null),
    groups: z.array(groupSchema).default([]),
    members: z.array(grantSchema).default([]),
    label: z.string().nullish().transform((value) => value ?? null),
    reset: z.boolean().default(false),
  })
  .nullable();
export type AccessSnapshot = z.infer<typeof snapshotSchema>;

const actorSchema = z
  .union([
    z.object({
      userId: z.string(),
      email: z.string(),
      name: z.string().nullish().transform((value) => value ?? null),
      member: z.literal(true),
    }),
    z.object({ userId: z.string(), member: z.literal(false) }),
  ])
  .nullable();

const historySchema = z.object({
  rows: z.array(
    z.object({
      seq: z.number().int(),
      at: z.string(),
      actorId: z.string().nullable(),
      actorName: z.string().nullable(),
      actor: actorSchema,
      version: z.number().int(),
      reason: z.string().nullable(),
      before: snapshotSchema,
      after: snapshotSchema,
    }),
  ),
  nextAfter: z.number().int().nullable(),
});
export type AccessHistoryPage = z.infer<typeof historySchema>;
export type AccessHistoryRow = AccessHistoryPage["rows"][number];

/** What one PATCH sends. `members` and `groups` replace the current lists. */
export type AccessChange = {
  mode: string;
  label: string | null;
  groups: AccessGroup[];
  /** Omitted only when the per-person list is unchanged (see SessionAccess). */
  members?: Array<{ email: string; perm: Perm }>;
  reason: string;
  expectedVersion: number;
};

/** Control's refusals, by the error code in its answer. */
export type AccessProblem =
  | { kind: "not_configured" }
  | { kind: "not_admin" }
  | { kind: "not_found"; message: string }
  | { kind: "conflict"; currentVersion: number | null }
  | { kind: "unknown_members"; emails: string[] }
  | { kind: "invalid"; message: string }
  | { kind: "unavailable" }
  | { kind: "outcome_unknown" }
  | { kind: "refused"; message: string };

const path = (workspace: string, session: string, suffix = "") =>
  `/v1/workspaces/${encodeURIComponent(workspace)}/sessions/${encodeURIComponent(session)}/access${suffix}`;

function field(body: unknown, name: string): unknown {
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

/**
 * Maps a failed call; callers handle SignedOut and their own aborts first. On
 * a write (`write`), an answer that never arrived, a gateway timeout or an
 * unreadable success may mean the change applied.
 */
export function accessProblem(error: unknown, write: boolean): AccessProblem {
  if (!(error instanceof ApiError)) {
    return write ? { kind: "outcome_unknown" } : { kind: "unavailable" };
  }
  switch (error.code) {
    case "session_access_not_configured":
      return { kind: "not_configured" };
    case "not_access_admin":
      return { kind: "not_admin" };
    case "not_found":
      return { kind: "not_found", message: error.message };
    case "conflict": {
      const version = field(error.body, "currentVersion");
      return {
        kind: "conflict",
        currentVersion:
          typeof version === "number" && Number.isSafeInteger(version)
            ? version
            : null,
      };
    }
    case "unknown_members": {
      const emails = field(error.body, "emails");
      return {
        kind: "unknown_members",
        emails: Array.isArray(emails)
          ? emails.filter((email): email is string => typeof email === "string")
          : [],
      };
    }
    case "invalid_request":
      return { kind: "invalid", message: error.message };
    case "session_access_outcome_unknown":
      return { kind: "outcome_unknown" };
    case "session_access_unavailable":
      return { kind: "unavailable" };
  }
  if (write && (error.status === 502 || error.status === 504)) {
    return { kind: "outcome_unknown" };
  }
  if (error.status >= 500) return { kind: "unavailable" };
  // csrf_rejected, forbidden, handoff_not_exchanged and anything else.
  return { kind: "refused", message: error.message };
}

/** A write whose 2xx answer cannot be read was still accepted. */
async function written(request: Promise<unknown>) {
  const body = await request;
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) throw new Error("unreadable answer");
  return parsed.data.access;
}

export const sessionAccessApi = {
  get: async (workspace: string, session: string, signal?: AbortSignal) =>
    (await adminRequest(path(workspace, session), answerSchema, { signal }))
      .access,
  set: (workspace: string, session: string, change: AccessChange) =>
    written(
      adminRequest(path(workspace, session), null, {
        method: "PATCH",
        body: change,
      }),
    ),
  reset: (
    workspace: string,
    session: string,
    input: { reason: string; expectedVersion: number },
  ) =>
    written(
      adminRequest(path(workspace, session, "/reset"), null, {
        method: "POST",
        body: input,
      }),
    ),
  history: (
    workspace: string,
    session: string,
    after: number | null,
    signal?: AbortSignal,
  ) =>
    adminRequest(
      path(
        workspace,
        session,
        `/history${after === null ? "" : `?${new URLSearchParams({ after: String(after) })}`}`,
      ),
      historySchema,
      { signal },
    ),
};
