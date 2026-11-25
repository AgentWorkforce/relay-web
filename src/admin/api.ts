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
  capturePolicySchema,
  type CaptureSettings,
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
  githubReleasesSchema,
  createdInstallTokenSchema,
  installTokenSummarySchema,
  installTokensSchema,
  type InstallTokenSummary,
  type GithubReleases,
  type FeedChannel,
  type FeedManifest,
  type FeedProfile,
  membersSchema,
  invitationLinkSchema,
  invitationsSchema,
  signInMethodsSchema,
  workspacesSchema,
  usageSchema,
  usagePeopleSchema,
  usagePersonSessionsSchema,
  workspaceLeadersSchema,
  delegationPolicySchema,
  delegateClaimSchema,
  delegateGrantSchema,
  delegateGrantsSchema,
  revokedGrantsSchema,
  trustRulePutSchema,
  trustRuleStateSchema,
  type DelegationClass,
  type TokenPurpose,
  type Role,
} from "./contracts";

export class SignedOut extends Error {}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The parsed error body, for answers that carry more than a code. */
    readonly body: unknown = null,
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
  const method = init.method ?? "GET";
  // Control's CSRF check refuses a cookie-authenticated write (POST, PUT,
  // PATCH, and DELETE on several routes) unless it is application/json with an
  // allowed Origin, so a bodiless write still sends an empty JSON object.
  const requestBody =
    init.body === undefined && method !== "GET" && method !== "HEAD"
      ? {}
      : init.body;
  const response = await fetch(`${base}${path}`, {
    method,
    signal: init.signal,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(requestBody !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
    body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,
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
      body,
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
  /** The configured GitHub releases repo's newest release; null when none is configured (404). */
  githubReleases: (signal?: AbortSignal): Promise<GithubReleases | null> =>
    orNull(call("/v1/desktop/releases", githubReleasesSchema, { signal })),
  downloadUrl: (profile: string, assetId: string) =>
    call(`/v1/desktop/feed/assets/${enc(assetId)}/download-url`, feedDownloadUrlSchema, {
      method: "POST",
      headers: feedHeaders(profile),
    }),
  /** The caller's own install tokens for the profile; null when the feed is off (404). */
  installTokens: async (
    profile: string,
    signal?: AbortSignal,
  ): Promise<InstallTokenSummary[] | null> =>
    (
      await orNull(
        call("/v1/desktop/feed/install-tokens", installTokensSchema, {
          signal,
          headers: feedHeaders(profile),
        }),
      )
    )?.tokens ?? null,
  /** The secret `token` is in this answer only; 429 past the hourly limit. */
  createInstallToken: (profile: string, label?: string) =>
    // Without a label call() sends `{}`, which the route accepts.
    call("/v1/desktop/feed/install-tokens", createdInstallTokenSchema, {
      method: "POST",
      headers: feedHeaders(profile),
      ...(label ? { body: { label } } : {}),
    }),
  /** 404 `install_token_not_found` when the id is unknown. */
  revokeInstallToken: (profile: string, id: string) =>
    call(`/v1/desktop/feed/install-tokens/${enc(id)}`, installTokenSummarySchema, {
      method: "DELETE",
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
  integrationProviders: (workspace: string, signal?: AbortSignal, refreshAuthorization = false) =>
    call(`${ws(workspace)}/integrations/providers${refreshAuthorization ? "?refreshAuthorization=true" : ""}`, integrationProvidersSchema, { signal }),
  disconnectIntegration: (workspace: string, provider: string, connectionId?: string, version?: string) => {
    const query = new URLSearchParams({ ...(connectionId ? { connectionId } : {}), ...(version ? { version } : {}) });
    return call(`${ws(workspace)}/integrations/${enc(provider)}${query.size ? `?${query}` : ""}`, null, { method: "DELETE" });
  },
  renameIntegration: (workspace: string, provider: string, connectionId: string, displayName: string, version?: string) =>
    call(`${ws(workspace)}/integrations/${enc(provider)}/settings`, null, { method: "PATCH", body: { connectionId, displayName, ...(version ? { version } : {}) } }),
  createIntegrationWithCredentials: (workspace: string, provider: string, credentials: Record<string, string>) =>
    call(`${ws(workspace)}/integrations/${enc(provider)}`, null, { method: "POST", body: { credentials } }),
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
  /** Owner-only; 403 `feature_not_enabled` while `usage_people` is off. */
  usagePeople: async (
    organization: string,
    days: 7 | 30 | 90,
    signal?: AbortSignal,
  ) =>
    (
      await call(
        `/v1/organizations/${enc(organization)}/usage/people?days=${days}`,
        usagePeopleSchema,
        { signal },
      )
    ).people,
  /** One member's sessions, newest first; 404 `user_not_found` for a non-member. */
  usagePersonSessions: (
    organization: string,
    userId: string,
    days: 7 | 30 | 90,
    cursor: string | null,
    signal?: AbortSignal,
  ) =>
    call(
      `/v1/organizations/${enc(organization)}/usage/people/${enc(userId)}/sessions?${new URLSearchParams(
        { days: String(days), ...(cursor ? { cursor } : {}) },
      )}`,
      usagePersonSessionsSchema,
      { signal },
    ),
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
  /** Owner/admin only; members get 403. Reads are never gated by SELFHOST_OPERATOR_CONTROLS. */
  capturePolicy: (organization: string, signal?: AbortSignal) =>
    call(`/v1/organizations/${enc(organization)}/capture-policy`, capturePolicySchema, { signal }),
  /** Replaces `settings` whole; a stale revision answers 409 revision_mismatch. */
  putCapturePolicy: (organization: string, settings: CaptureSettings, revision: number) =>
    call(`/v1/organizations/${enc(organization)}/capture-policy`, capturePolicySchema, {
      method: "PUT",
      body: { settings },
      headers: { "If-Match": String(revision) },
    }),
  /** Back to every key unset (`settings: {}`); the revision still goes up. */
  clearCapturePolicy: (organization: string, revision: number) =>
    call(`/v1/organizations/${enc(organization)}/capture-policy`, capturePolicySchema, {
      method: "DELETE",
      headers: { "If-Match": String(revision) },
    }),
  /** Any member reads; also the agents the patterns match right now. */
  getWorkspaceLeaders: (workspace: string, signal?: AbortSignal) =>
    call(`${ws(workspace)}/leaders`, workspaceLeadersSchema, { signal }),
  /**
   * Owner/admin only; replaces the whole pattern list. 400 `invalid_request`
   * for a bad list, 502 `workspace_leaders_unavailable` when the Relaycast
   * engine cannot be reached.
   */
  setWorkspaceLeaders: (workspace: string, patterns: string[]) =>
    call(`${ws(workspace)}/leaders`, workspaceLeadersSchema, {
      method: "PUT",
      body: { patterns },
    }),
  /** Any member reads: the stored policy, or the defaults when none is stored. */
  delegationPolicy: (workspace: string, signal?: AbortSignal) =>
    call(`${ws(workspace)}/delegates/policy`, delegationPolicySchema, { signal }),
  /**
   * Owner/admin only. Sends only `delegation_enabled`, so every other policy
   * field keeps its stored value; 403 `forbidden` for anyone else.
   */
  setDelegationEnabled: (workspace: string, enabled: boolean) =>
    call(`${ws(workspace)}/delegates/policy`, delegationPolicySchema, {
      method: "PUT",
      body: { delegation_enabled: enabled },
    }),
  /** The caller's grants; owners and admins pass `all` for every grant. Allowed while delegation is off. */
  delegateGrants: async (workspace: string, all: boolean, signal?: AbortSignal) =>
    (await call(`${ws(workspace)}/delegates${all ? "?all=1" : ""}`, delegateGrantsSchema, { signal })).grants,
  /** Refused with `not_enabled` while delegation is off; `not_delegate` unless the agent is bound to the caller. */
  createDelegateGrant: (
    workspace: string,
    input: {
      delegate_agent_id: string;
      scopes: Array<{ class: DelegationClass; targets: string[] }>;
      expires_at?: string;
      require_tier_o?: DelegationClass[];
    },
  ) => call(`${ws(workspace)}/delegates`, delegateGrantSchema, { method: "POST", body: input }),
  /** The grant's owner or an owner/admin; idempotent, allowed while delegation is off. */
  revokeDelegateGrant: (workspace: string, grant: string) =>
    call(`${ws(workspace)}/delegates/${enc(grant)}`, delegateGrantSchema, { method: "DELETE" }),
  /** The caller's active grants, or with `all` (owner/admin) every grant in the workspace. */
  revokeAllDelegateGrants: async (workspace: string, all: boolean) =>
    (await call(`${ws(workspace)}/delegates/revoke-all`, revokedGrantsSchema, {
      method: "POST",
      body: all ? { all: true } : {},
    })).revoked,
  /** A one-time claim code, valid for 10 minutes; refused with `not_enabled` while delegation is off. */
  startDelegateClaim: (workspace: string) =>
    call(`${ws(workspace)}/delegates/claims`, delegateClaimSchema, { method: "POST" }),
  /** The caller's own trust rule (`rule: null` when off), the agents it covers and the bots whose own grant wins. */
  trustRule: (workspace: string, signal?: AbortSignal) =>
    call(`${ws(workspace)}/delegates/trust-rule`, trustRuleStateSchema, { signal }),
  /**
   * Turns the caller's rule on (idempotent). Sends `{}` as Cloud does: no
   * class keeps an owner tap (#owner-decisions 251241083284656128).
   * `not_enabled` while delegation is off.
   */
  putTrustRule: (workspace: string) =>
    call(`${ws(workspace)}/delegates/trust-rule`, trustRulePutSchema, { method: "PUT", body: {} }),
  /** Ends the rule and every grant it created; 404 `not_found` when no rule is on. */
  revokeTrustRule: (workspace: string) =>
    call(`${ws(workspace)}/delegates/trust-rule`, null, { method: "DELETE" }),
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
