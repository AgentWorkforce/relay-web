// Optional direct reads from the session read API (default off; set
// DASHBOARD_SESSION_READ_API_ENABLED=true). Control stays the only sign-in: the
// page swaps its session cookie for a short-lived access token at
// POST /cloud/api/v1/workspaces/:id/session-read/session and asks again when it
// expires. The token lives in memory, and a handoff carrying a refresh token is
// refused so that a refresh token is never held by page scripts.
import { z } from "zod";

/** The read path failed or isn't available. A first page falls back to Control. */
export class ReadApiUnavailable extends Error {
  constructor(readonly reason: string) {
    super("Session history is temporarily unavailable. Please try again.");
  }
}

export const readApiEnabled = () =>
  typeof window !== "undefined" &&
  window.__AGENT_RELAY_DASHBOARD_CONFIG__?.sessionReadApi === true;

const DIRECT_CURSOR = "ra1:";
/** Read API cursors can only continue there, so they are marked on the way out. */
export const isDirectCursor = (cursor: string | null) =>
  !!cursor && cursor.startsWith(DIRECT_CURSOR);
export const toDirectCursor = (cursor: unknown) =>
  typeof cursor === "string" && cursor ? `${DIRECT_CURSOR}${cursor}` : null;
export const fromDirectCursor = (cursor: string | null) =>
  cursor ? cursor.slice(DIRECT_CURSOR.length) : undefined;

const WORKSPACE_HEADER = "X-Relayhistory-Workspace-Id";
const EXPIRY_MARGIN_MS = 30_000;

const handoffSchema = z.object({
  baseUrl: z.string(),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.string(),
  tokenType: z.literal("Bearer"),
  scopes: z.array(z.string()),
  workspaceId: z.string(),
});

type Access = { baseUrl: string; token: string; expiresAt: number };
const handoffs = new Map<string, Promise<Access>>();

/** Forget every held access token (tests, sign-out). */
export function forgetReadApiAccess() {
  handoffs.clear();
}

function readApiOrigin(raw: string): string {
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const bare =
    (url.pathname === "/" || url.pathname === "") &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;
  if (!bare || !(url.protocol === "https:" || (loopback && url.protocol === "http:")))
    throw new ReadApiUnavailable("untrusted_base_url");
  return url.origin;
}

async function requestHandoff(workspace: string): Promise<Access> {
  let response: Response;
  try {
    response = await fetch(
      `/cloud/api/v1/workspaces/${encodeURIComponent(workspace)}/session-read/session`,
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: "{}",
      },
    );
  } catch {
    throw new ReadApiUnavailable("handoff_unreachable");
  }
  if (!response.ok) throw new ReadApiUnavailable(`handoff_${response.status}`);
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && ("refreshToken" in body || "refreshTokenExpiresAt" in body))
    throw new ReadApiUnavailable("handoff_exposed_refresh_token");
  const parsed = handoffSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.workspaceId !== workspace ||
    !parsed.data.scopes.includes("rth:read") ||
    !parsed.data.accessToken.startsWith("rth_at_read_")
  )
    throw new ReadApiUnavailable("handoff_invalid");
  const expiresAt = Date.parse(parsed.data.accessTokenExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
    throw new ReadApiUnavailable("handoff_expired");
  let baseUrl: string;
  try {
    baseUrl = readApiOrigin(parsed.data.baseUrl);
  } catch {
    throw new ReadApiUnavailable("untrusted_base_url");
  }
  return { baseUrl, token: parsed.data.accessToken, expiresAt };
}

async function accessFor(workspace: string): Promise<Access> {
  const held = handoffs.get(workspace);
  if (held) {
    const access = await held.catch(() => null);
    if (access && access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return access;
    if (handoffs.get(workspace) === held) handoffs.delete(workspace);
  }
  const pending = handoffs.get(workspace) ?? requestHandoff(workspace);
  handoffs.set(workspace, pending);
  pending.catch(() => {
    if (handoffs.get(workspace) === pending) handoffs.delete(workspace);
  });
  return pending;
}

/** GET a read API route for one workspace, with the same attestation rule as Control. */
export async function readApiGet(
  workspace: string,
  path: string,
  params: Record<string, string | undefined>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const access = await accessFor(workspace);
    const url = new URL(path, access.baseUrl);
    for (const [name, value] of Object.entries(params))
      if (value) url.searchParams.set(name, value);
    url.searchParams.set("workspace", workspace);
    let response: Response;
    try {
      response = await fetch(url, {
        signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json", Authorization: `Bearer ${access.token}` },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ReadApiUnavailable("read_unreachable");
    }
    if (response.status === 401 && attempt === 0) {
      handoffs.delete(workspace);
      continue;
    }
    if (!response.ok) throw new ReadApiUnavailable(`read_${response.status}`);
    if (response.headers.get(WORKSPACE_HEADER) !== workspace)
      throw new ReadApiUnavailable("workspace_not_attested");
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ReadApiUnavailable("read_invalid");
    return body as Record<string, unknown>;
  }
  throw new ReadApiUnavailable("read_401");
}

/**
 * Use the read API when it can serve this request. Only a first page falls back
 * to Control; a read API cursor is never restarted elsewhere.
 */
export async function viaReadApi<T>(
  next: string | null,
  signal: AbortSignal,
  direct: () => Promise<T>,
  control: () => Promise<T>,
): Promise<T> {
  if (!readApiEnabled() || (next && !isDirectCursor(next))) return control();
  try {
    return await direct();
  } catch (error) {
    if (next || signal.aborted) throw error;
    return control();
  }
}
