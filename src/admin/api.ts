import type { z } from "zod";
import {
  adminContextSchema,
  factoryConnectionSchema,
  factoryComputersSchema,
  factorySessionsSchema,
  factoryBindingsSchema,
  factoryBoundSessionSchema,
  sessionErasureSchema,
  apiTokensSchema,
  codingAgentCheckSchema,
  codingAgentsSchema,
  integrationConnectSchema,
  integrationProvidersSchema,
  deviceLoginStartSchema,
  deviceLoginStatusSchema,
  createdTokenSchema,
  envVarListSchema,
  envVarSchema,
  feedDownloadUrlSchema,
  feedEnvelopeSchema,
  feedProfilesSchema,
  type FeedChannel,
  type FeedManifest,
  type FeedProfile,
  membersSchema,
  invitationLinkSchema,
  invitationsSchema,
  signInMethodsSchema,
  workspacesSchema,
  usageSchema,
  type TokenPurpose,
  type Role,
} from "./contracts";

export class SignedOut extends Error {}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const base = "/cloud/api";
const enc = encodeURIComponent;

async function call<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    signal: init.signal,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (response.status === 401) throw new SignedOut();
  const text = response.status === 204 ? "" : await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(
      response.status,
      detail.error ?? "request_failed",
      detail.message ??
        (response.status === 403
          ? "Only organization owners and admins can do that."
          : "Something went wrong. Please try again."),
    );
  }
  return schema ? schema.parse(body) : (body as T);
}

const ws = (id: string) => `/v1/workspaces/${enc(id)}`;

const feedHeaders = (profile: string) => ({ "X-Agent-Relay-Profile": profile });

/** A 404 is an answer here: the feed is off, or the channel has no release. */
async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export const desktopFeedApi = {
  profiles: async (signal?: AbortSignal): Promise<FeedProfile[]> =>
    (await orNull(call("/v1/desktop/profiles", feedProfilesSchema, { signal })))?.profiles ?? [],
  manifest: async (
    profile: string,
    channel: FeedChannel,
    signal?: AbortSignal,
  ): Promise<FeedManifest | null> =>
    (
      await orNull(
        call(`/v1/desktop/feed/manifest?channel=${channel}`, feedEnvelopeSchema, {
          signal,
          headers: feedHeaders(profile),
        }),
      )
    )?.manifest ?? null,
  downloadUrl: (profile: string, assetId: string) =>
    call(`/v1/desktop/feed/assets/${enc(assetId)}/download-url`, feedDownloadUrlSchema, {
      method: "POST",
      headers: feedHeaders(profile),
    }),
};

export const adminApi = {
  context: (signal?: AbortSignal) =>
    call("/v1/auth/whoami", adminContextSchema, { signal }),

  // The API key is sent once to Control; only its masked hint comes back.
  factoryConnection: async (workspace: string, signal?: AbortSignal) => {
    try { return await call(`${ws(workspace)}/factory/connection`, factoryConnectionSchema, { signal }); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404 && error.code === "not_found") return null;
      throw error;
    }
  },
  connectFactory: (workspace: string, key: string) =>
    call(`${ws(workspace)}/factory/connection`, factoryConnectionSchema, {
      method: "PUT", body: { key },
    }),
  disconnectFactory: (workspace: string) =>
    call(`${ws(workspace)}/factory/connection`, null, { method: "DELETE" }),
  factoryComputers: (workspace: string, signal?: AbortSignal) =>
    call(`${ws(workspace)}/factory/computers`, factoryComputersSchema, { signal }),
  factorySessions: (workspace: string, computer: string, signal?: AbortSignal) =>
    call(`${ws(workspace)}/factory/computers/${enc(computer)}/sessions`, factorySessionsSchema, { signal }),
  factoryBindings: (workspace: string, signal?: AbortSignal) =>
    call(`${ws(workspace)}/factory/bindings`, factoryBindingsSchema, { signal }),
  bindFactory: (workspace: string, session: string, computer: string) =>
    call(`${ws(workspace)}/factory/bindings`, factoryBoundSessionSchema, {
      method: "POST", body: { session_id: session, computer_id: computer },
    }),
  unbindFactory: (workspace: string, binding: string) =>
    call(`${ws(workspace)}/factory/bindings/${enc(binding)}`, null, { method: "DELETE" }),

  listEnv: async (workspace: string, signal?: AbortSignal) =>
    (await call(`${ws(workspace)}/secrets`, envVarListSchema, { signal })).data
      .items,
  putEnv: (workspace: string, name: string, value: string) =>
    call(`${ws(workspace)}/secrets`, envVarSchema, {
      method: "POST",
      body: { name, envVar: name, value, kind: "environment" },
    }),
  deleteEnv: (workspace: string, name: string) =>
    // The response body (the deleted record) isn't used; accept an empty one.
    call(`${ws(workspace)}/secrets/${enc(name)}`, null, {
      method: "DELETE",
    }),

  /** Integration status for just-in-time connects (flows, CLI). */
  integrationProviders: (workspace: string, signal?: AbortSignal) =>
    call(`${ws(workspace)}/integrations/providers`, integrationProvidersSchema, { signal }),
  /** Starts a provider OAuth connect; the callback page links back to returnTo. */
  connectIntegration: (workspace: string, provider: string, returnTo: string) =>
    call(`${ws(workspace)}/integrations/connect-session`, integrationConnectSchema, {
      method: "POST",
      body: { allowedIntegrations: [provider], returnTo },
    }),
  codingAgents: (workspace: string, signal?: AbortSignal) =>
    call(`${ws(workspace)}/cloud-agents`, codingAgentsSchema, { signal }),
  putAgentApiKey: (
    workspace: string,
    input: { modelProvider: string; key: string; label?: string },
  ) =>
    call(`${ws(workspace)}/provider-credentials/byok`, null, {
      method: "POST",
      body: input,
    }),
  putAgentSetupToken: (
    workspace: string,
    input: { token: string; accountEmail?: string; label?: string },
  ) =>
    call(`${ws(workspace)}/provider-credentials/setup-token`, null, {
      method: "POST",
      body: input,
    }),
  activateAgent: (workspace: string, id: string, selection: "model" | "harness") =>
    call(`${ws(workspace)}/cloud-agents/${enc(id)}/activate`, null, {
      method: "POST",
      body: { selection },
    }),
  checkAgent: (workspace: string, id: string) =>
    call(`${ws(workspace)}/cloud-agents/${enc(id)}/check`, codingAgentCheckSchema, {
      method: "POST",
      body: {},
    }),
  /** Hosted provider-credentials/{openai,xai}-device/start; the binding cookie is httpOnly. */
  startDeviceLogin: (workspace: string, provider: "openai" | "xai") =>
    call(`${ws(workspace)}/provider-credentials/${provider}-device/start`, deviceLoginStartSchema, {
      method: "POST",
      body: {},
    }),
  pollDeviceLogin: (workspace: string, provider: "openai" | "xai", transactionId: string) =>
    call(`${ws(workspace)}/provider-credentials/${provider}-device/status`, deviceLoginStatusSchema, {
      method: "POST",
      body: { transactionId },
    }),
  deleteAgent: (workspace: string, id: string) =>
    call(`${ws(workspace)}/cloud-agents/${enc(id)}`, null, { method: "DELETE" }),

  listTokens: async (workspace: string, signal?: AbortSignal) =>
    (
      await call(`${ws(workspace)}/deployment-api-tokens`, apiTokensSchema, {
        signal,
      })
    ).tokens,
  createToken: (
    workspace: string,
    input: {
      label: string;
      purpose: TokenPurpose;
      expiryDays?: number;
      neverExpires?: boolean;
    },
  ) =>
    call(`${ws(workspace)}/deployment-api-tokens`, createdTokenSchema, {
      method: "POST",
      body: input,
    }),
  revokeToken: (workspace: string, id: string) =>
    call(`${ws(workspace)}/deployment-api-tokens/${enc(id)}`, null, {
      method: "DELETE",
    }),

  members: async (organization: string, signal?: AbortSignal) =>
    (
      await call(
        `/v1/organizations/${enc(organization)}/memberships`,
        membersSchema,
        {
          signal,
        },
      )
    ).memberships,
  putMember: (
    organization: string,
    input: { email: string; name: string; role: Role },
  ) =>
    call(`/v1/organizations/${enc(organization)}/memberships`, null, {
      method: "POST",
      body: input,
    }),
  removeMember: (organization: string, userId: string) =>
    call(
      `/v1/organizations/${enc(organization)}/memberships/${enc(userId)}`,
      null,
      { method: "DELETE" },
    ),
  invitations: async (organization: string, signal?: AbortSignal) =>
    (
      await call(
        `/v1/organizations/${enc(organization)}/invitations`,
        invitationsSchema,
        { signal },
      )
    ).invitations,
  invite: (organization: string, input: { email: string; role: Role }) =>
    call(
      `/v1/organizations/${enc(organization)}/invitations`,
      invitationLinkSchema,
      { method: "POST", body: input },
    ),
  /** A fresh link for an open invite (earlier links stop working); `send` re-emails it. */
  inviteLink: (organization: string, id: string, send = false) =>
    call(
      `/v1/organizations/${enc(organization)}/invitations/${enc(id)}/link`,
      invitationLinkSchema,
      { method: "POST", body: { send } },
    ),
  revokeInvite: (organization: string, id: string) =>
    call(
      `/v1/organizations/${enc(organization)}/invitations/${enc(id)}`,
      null,
      { method: "DELETE" },
    ),
  /** Owner-only; 403 `feature_not_enabled` while the install's usage flag is off. */
  usage: async (organization: string, days: 7 | 30 | 90, signal?: AbortSignal) =>
    (
      await call(
        `/v1/organizations/${enc(organization)}/usage?days=${days}`,
        usageSchema,
        { signal },
      )
    ).usage,
  signInMethods: (signal?: AbortSignal) =>
    call("/v1/auth/methods", signInMethodsSchema, { signal }),
  workspaces: async (organization: string, signal?: AbortSignal) =>
    (
      await call(
        `/v1/organizations/${enc(organization)}/workspaces`,
        workspacesSchema,
        {
          signal,
        },
      )
    ).workspaces,
  renameOrganization: (organization: string, name: string) =>
    call(`/v1/organizations/${enc(organization)}`, null, {
      method: "PATCH",
      body: { name },
    }),
  hardDeleteSession: (
    organization: string,
    session: { workspaceId: string; source: string; sessionId: string },
  ) =>
    call(
      `/v1/organizations/${enc(organization)}/sessions/${enc(session.sessionId)}?${new URLSearchParams({ workspaceId: session.workspaceId, source: session.source })}`,
      sessionErasureSchema,
      { method: "DELETE" },
    ),
};

export const canManage = (role: Role) => role === "owner" || role === "admin";

// Shared authenticated JSON transport for workspace settings modules.
export { call as adminRequest };
