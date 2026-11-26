import { z } from "zod";

const nullableText = z.string().nullable().optional();
export const roleSchema = z.enum(["owner", "admin", "member"]);
export type Role = z.infer<typeof roleSchema>;

export const adminContextSchema = z.object({
  user: z.object({ id: z.string(), email: nullableText, name: nullableText }),
  currentOrganization: z.object({
    id: z.string(),
    name: z.string(),
    role: roleSchema,
  }),
  currentWorkspace: z.object({ id: z.string(), name: z.string() }),
});
export type AdminContext = z.infer<typeof adminContextSchema>;

/** Control's Factory connection responses never contain the saved API key. */
export const factoryConnectionSchema = z.object({
  connected: z.boolean(),
  key_hint: z.string().nullable(),
  validated_at: z.string().nullable(),
  user_is_owner: z.boolean(),
  bindings_count: z.number().int().nonnegative(),
  history: z.literal("deferred"),
});
export type FactoryConnection = z.infer<typeof factoryConnectionSchema>;
export const factoryComputersSchema = z.object({
  computers: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
});
export const factorySessionsSchema = z.object({
  sessions: z.array(z.object({
    id: z.string(), title: z.string(), computer_id: z.string(),
    bound: z.enum(["here", "elsewhere"]).nullable(),
  })),
  warning: z.string().optional(),
});
export const factoryBindingSchema = z.object({
  id: z.string(), session_id: z.string(), computer_id: z.string(), state: z.enum(["preparing", "bound", "retired"]),
  agent: z.object({ name: z.string().nullable(), id: z.string().nullable() }),
  history: z.literal("deferred"), created_at: z.string().nullable(),
  updated_at: z.string().nullable(), retired_at: z.string().nullable(),
});
export const factoryBindingsSchema = z.object({
  bindings: z.array(factoryBindingSchema), history: z.literal("deferred"),
});
export const factoryBoundSessionSchema = z.object({
  binding_id: z.string(), session_id: z.string(),
  agent: z.object({ name: z.string(), id: z.string().nullable() }),
});

export const sessionErasureSchema = z.object({
  status: z.enum(["in_progress", "completed", "failed"]),
  unreadable: z.boolean(),
});

export const envVarSchema = z.object({
  name: z.string(),
  maskedValue: z.string(),
  deliveredToFlowRuns: z.boolean().optional(),
  setBy: nullableText,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EnvVar = z.infer<typeof envVarSchema>;
export const envVarListSchema = z.object({
  data: z.object({ items: z.array(envVarSchema) }),
});

export const tokenPurposeSchema = z.enum([
  "agent-runtime",
  "workflow",
  "deployment",
]);
export type TokenPurpose = z.infer<typeof tokenPurposeSchema>;
export const apiTokenSchema = z.object({
  id: z.string(),
  label: z.string(),
  purpose: tokenPurposeSchema,
  scopes: z.array(z.string()),
  createdBy: z
    .object({ id: z.string(), name: nullableText, email: nullableText })
    .nullable(),
  createdAt: z.string(),
  accessTokenExpiresAt: nullableText,
  lastUsedAt: nullableText,
  status: z.enum(["active", "expired", "revoked"]),
});
export type ApiToken = z.infer<typeof apiTokenSchema>;
export const apiTokensSchema = z.object({ tokens: z.array(apiTokenSchema) });
export const createdTokenSchema = apiTokenSchema.extend({
  accessToken: z.string(),
});

export const memberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  joinedAt: nullableText,
});
export type Member = z.infer<typeof memberSchema>;
export const membersSchema = z.object({ memberships: z.array(memberSchema) });

/** Self-host invites (relaycontrol /organizations/{id}/invitations). */
export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: roleSchema,
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  invitedBy: z
    .object({ id: z.string(), name: nullableText, email: nullableText })
    .nullable()
    .optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type Invitation = z.infer<typeof invitationSchema>;
export const invitationsSchema = z.object({
  invitations: z.array(invitationSchema),
});
export const emailDeliverySchema = z.enum([
  "sent",
  "failed",
  "not_configured",
  "skipped",
]);
export type EmailDelivery = z.infer<typeof emailDeliverySchema>;
export const invitationLinkSchema = z.object({
  invitation: invitationSchema,
  inviteUrl: z.string(),
  emailDelivery: emailDeliverySchema,
});
export type InvitationLink = z.infer<typeof invitationLinkSchema>;
export const signInMethodsSchema = z.object({
  oidc: z
    .object({ displayName: z.string(), allowedDomains: z.array(z.string()) })
    .nullable(),
  emailLink: z.boolean(),
  inviteEmail: z.boolean(),
  autoJoinDomains: z.array(z.string()),
  inviteTtlHours: z.number(),
});
export type SignInMethods = z.infer<typeof signInMethodsSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  relaycastWorkspaceId: z.string().optional(),
});
export const workspacesSchema = z.object({
  workspaces: z.array(workspaceSchema),
});


/** Hosted `CloudAgent` (Settings > Connections > Coding agents). No secrets. */
export const codingAgentSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  harness: z.string(),
  modelProvider: z.string(),
  authType: z.string(),
  label: nullableText,
  accountEmail: nullableText,
  secretPreview: z.string(),
  isActive: z.boolean(),
  harnessActive: z.boolean().optional(),
  defaultModel: nullableText,
  status: z.string(),
  lastAuthenticatedAt: nullableText,
  lastCheckedAt: nullableText,
  lastUsedAt: nullableText,
  lastError: nullableText,
  createdAt: z.string(),
  updatedAt: z.string(),
  owner: z
    .object({
      userId: z.string(),
      name: nullableText,
      email: nullableText,
      avatarUrl: nullableText,
    })
    .nullable()
    .optional(),
});
export type CodingAgent = z.infer<typeof codingAgentSchema>;

export const codingAgentProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  harness: z.string(),
  envName: z.string(),
  authTypes: z.array(z.string()),
  keyPlaceholder: z.string().optional(),
  docsUrl: z.string().optional(),
});
export type CodingAgentProvider = z.infer<typeof codingAgentProviderSchema>;

export const codingAgentsSchema = z.object({
  agents: z.array(codingAgentSchema),
  providers: z.array(codingAgentProviderSchema),
  canManage: z.boolean(),
});
export type CodingAgentsView = z.infer<typeof codingAgentsSchema>;

export const codingAgentCheckSchema = z.object({
  status: z.enum(["available", "unavailable", "unsupported", "error"]),
  checkedAt: z.string(),
  message: z.string(),
});
export type CodingAgentCheck = z.infer<typeof codingAgentCheckSchema>;

export const deviceLoginStartSchema = z.object({
  transactionId: z.string(),
  verificationUri: z.string().url(),
  userCode: z.string(),
  intervalSeconds: z.number().int().positive(),
  expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "expiresAt must be a valid date"),
});
export const deviceLoginStatusSchema = z.object({
  status: z.enum(["pending", "connected", "expired", "failed"]),
  retryAfterSeconds: z.number().int().positive().optional(),
  providerCredentialId: z.string().optional(),
});

/** Just-in-time integration status (relaycontrol GET integrations/providers). */
export const integrationProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  authMode: z.enum(["OAUTH2", "API_KEY"]),
  configured: z.boolean(),
  adminMessage: z.string().optional(),
  credentialFields: z.array(z.object({ key: z.string(), label: z.string(), secret: z.boolean(), required: z.boolean(), placeholder: z.string().optional() })).optional(),
  connection: z.object({
    status: z.enum(["ready", "error"]),
    authorizationStatus: z.enum(["active", "inactive", "unknown"]).optional(),
    authorizationReason: z.string().optional(),
    authorizationCheckedAt: z.string().optional(),
    upstreamConnected: z.boolean().nullable().optional(),
    connectionId: z.string().optional(),
    version: z.string().optional(),
    providerConfigKey: nullableText,
    authMode: z.enum(["oauth2", "api_key", "github_app"]).optional(),
    accountLabel: nullableText,
    scopes: z.array(z.string()).optional(),
    connectedAt: nullableText,
    lastRefreshedAt: nullableText,
    metadata: z.object({ displayName: z.string().optional() }).passthrough().optional(),
  }).passthrough().nullable(),
}).passthrough();
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;
export const integrationProvidersSchema = z.object({
  providers: z.array(integrationProviderSchema),
  canManage: z.boolean().optional(),
}).passthrough();
export const integrationConnectSchema = z.object({ connectLink: z.string().url() }).passthrough();

export const feedProfilesSchema = z.object({
  profiles: z.array(z.object({ id: z.string(), asset_prefix: z.string() })),
});
export type FeedProfile = z.infer<typeof feedProfilesSchema>["profiles"][number];
export type FeedChannel = "stable" | "beta";

const feedAssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: z.string(),
  arch: z.string(),
  os_floor: z.number().optional(),
  kind: z.string(),
  size: z.number(),
  sha256: z.string(),
});
export type FeedAsset = z.infer<typeof feedAssetSchema>;

export const feedEnvelopeSchema = z.object({
  manifest: z.object({
    version: z.string(),
    published_at: z.string(),
    assets: z.array(feedAssetSchema),
  }),
});
export type FeedManifest = z.infer<typeof feedEnvelopeSchema>["manifest"];

/**
 * relay-control GET /desktop/releases: the newest release of a configured
 * GitHub releases repo, for installs without the signed feed. The assets carry
 * the manifest's fields plus a direct download `url`. `release` is null when
 * the repo has no usable release or GitHub could not be reached.
 */
const githubReleaseAssetSchema = feedAssetSchema.extend({ url: z.string() });
export type GithubReleaseAsset = z.infer<typeof githubReleaseAssetSchema>;
export const githubReleasesSchema = z.object({
  source: z.object({
    kind: z.literal("github"),
    repo: z.string(),
    releasesUrl: z.string(),
  }),
  release: z
    .object({
      version: z.string(),
      tag: z.string(),
      prerelease: z.boolean(),
      published_at: z.string(),
      assets: z.array(githubReleaseAssetSchema),
    })
    .nullable(),
});
export type GithubReleases = z.infer<typeof githubReleasesSchema>;

export const feedDownloadUrlSchema = z.object({ url: z.string(), expires_at: z.string() });

/**
 * relay-control /desktop/feed/install-tokens: short-lived tokens for a first
 * headless install, read-only on one profile's release feed. The secret
 * `token` comes back once, from the create call; summaries carry only its
 * first characters. The create answer's `command` is not used.
 */
export const installTokenSummarySchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  token_prefix: z.string(),
  profile: z.string(),
  workspace_id: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
  status: z.enum(["active", "expired", "revoked"]),
});
export type InstallTokenSummary = z.infer<typeof installTokenSummarySchema>;
export const installTokensSchema = z.object({ tokens: z.array(installTokenSummarySchema) });
export const createdInstallTokenSchema = z.object({
  id: z.string(),
  token: z.string(),
  label: z.string().nullable(),
  profile: z.string(),
  workspace_id: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
});
export type CreatedInstallToken = z.infer<typeof createdInstallTokenSchema>;

/** relay-control GET /organizations/{id}/usage: counts only, never identities. */
const usageCount = z.number().int().nonnegative();
export const usageMetricSchema = z.enum([
  "activeUsers",
  "sessionsUploaded",
  "searches",
  "summaries",
]);
export type UsageMetric = z.infer<typeof usageMetricSchema>;
const usageCounts = z.object({
  activeUsers: usageCount,
  sessionsUploaded: usageCount,
  searches: usageCount,
  summaries: usageCount.nullable(),
});
export const usageSchema = z.object({
  usage: z.object({
    range: z.object({ days: z.number().int(), from: z.string(), to: z.string() }),
    totals: usageCounts,
    days: z.array(usageCounts.extend({ date: z.string() })),
    unavailable: z.array(z.string()).default([]),
  }),
});
export type Usage = z.infer<typeof usageSchema>["usage"];

/**
 * relay-control GET /organizations/{id}/usage/people (owner-only, behind the
 * `usage_people` capability): per-member counts for the selected range.
 */
const usageRange = z.object({
  days: z.number().int(),
  from: z.string(),
  to: z.string(),
});
const projectCount = z.object({
  name: z.string(),
  sessions: usageCount,
});
export const usagePersonSchema = z.object({
  userId: z.string(),
  name: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  role: z.string(),
  sessionsUploaded: usageCount.nullable(),
  searches: usageCount.nullable().default(null),
  lastActiveAt: z.string().nullable().default(null),
  lastSessionAt: z.string().nullable().default(null),
  topProjects: z.array(projectCount).default([]),
});
export type UsagePerson = z.infer<typeof usagePersonSchema>;
export const usagePeopleSchema = z.object({
  people: z.object({
    range: usageRange,
    members: z.array(usagePersonSchema),
    truncated: z.boolean().default(false),
    unavailable: z.array(z.string()).default([]),
  }),
});
export type UsagePeople = z.infer<typeof usagePeopleSchema>["people"];

/** GET /organizations/{id}/usage/people/{userId}/sessions: newest first. */
export const usagePersonSessionSchema = z.object({
  sessionId: z.string(),
  source: z.string(),
  workspaceId: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  agentName: z.string().nullable().default(null),
  project: z.string().nullable().default(null),
  firstTs: z.string().nullable().default(null),
  lastTs: z.string().nullable().default(null),
});
export type UsagePersonSession = z.infer<typeof usagePersonSessionSchema>;
export const usagePersonSessionsSchema = z.object({
  person: z.object({
    userId: z.string(),
    name: z.string().nullable().default(null),
    email: z.string().nullable().default(null),
    role: z.string(),
  }),
  range: usageRange,
  rollup: z
    .object({
      titles: z.array(z.string()).default([]),
      projects: z.array(projectCount).default([]),
    })
    .nullable()
    .default(null),
  sessions: z.array(usagePersonSessionSchema),
  nextCursor: z.string().nullable().default(null),
});
export type UsagePersonSessions = z.infer<typeof usagePersonSessionsSchema>;

/**
 * relay-control capture policy (docs/capture-policy.md). A key present in
 * `settings` is enforced by Agent Relay Desktop; an absent key is each
 * person's choice. `revision` only goes up and is sent back as If-Match.
 */
export const sharingModeSchema = z.enum(["selected", "new", "all"]);
export const uploadControlSchema = z.enum(["operator", "user"]);
export const MAX_OOPS_WINDOW_SECONDS = 86_400;
// Loose: a key this build does not know yet is kept and written back unchanged.
export const captureSettingsSchema = z.looseObject({
  sharing_mode: sharingModeSchema.optional(),
  upload_control: uploadControlSchema.optional(),
  oops_window_seconds: z
    .number()
    .int()
    .min(0)
    .max(MAX_OOPS_WINDOW_SECONDS)
    .optional(),
  user_retroactive_delete: z.boolean().optional(),
});
export type CaptureSettings = z.infer<typeof captureSettingsSchema>;
export const capturePolicySchema = z.object({
  version: z.literal(1),
  revision: z.number().int().positive(),
  settings: captureSettingsSchema,
});
export type CapturePolicy = z.infer<typeof capturePolicySchema>;

/**
 * relay-control GET|PUT /workspaces/{id}/leaders: the agent-name patterns
 * whose DMs hosts treat as instructions from a lead, and the agents they
 * match right now. Any member reads; owners and admins write.
 */
export const MAX_LEADER_PATTERNS = 64;
export const MAX_LEADER_PATTERN_LENGTH = 128;
export const workspaceLeadersSchema = z.object({
  leaders: z.array(z.object({ name: z.string(), agent_id: z.string() })),
  patterns: z.array(z.string()),
});
export type WorkspaceLeaders = z.infer<typeof workspaceLeadersSchema>;

/**
 * relay-control GET|PUT /workspaces/{id}/delegates/policy
 * (getDelegationPolicy, putDelegationPolicy): the workspace's owner-delegation
 * switch. Any member reads; owners and admins write. Only the switch is read
 * here; the PUT keeps every field it is not sent at its stored value.
 */
export const delegationPolicySchema = z.object({
  delegation_enabled: z.boolean(),
  /** The longest grant lifetime the workspace allows, in days. */
  max_expiry_days: z.number().int().positive(),
});
export type DelegationPolicy = z.infer<typeof delegationPolicySchema>;

/** relay-control's DelegationActionClass: the classes a grant or approval can name. */
export const DELEGATION_CLASSES = [
  "merge", "pr_ops", "deploy", "release", "secret_change", "destructive", "spend", "external_comms", "prompt_approval",
  "config_change",
] as const;
export type DelegationClass = (typeof DELEGATION_CLASSES)[number];
/** One line per class for the class picker (Cloud's lib/delegation/classes.ts, from the class table, §5.1). */
export const DELEGATION_CLASS_DESCRIPTIONS: Record<DelegationClass, string> = {
  merge: "Merge a pull request or turn on auto-merge.",
  pr_ops: "Close, reopen, label, comment on, request review on or re-run CI for a pull request.",
  deploy: "Deploy a service to a named environment. Each approval works once.",
  release: "Publish a package or GitHub release, or cut a tag. Each approval works once.",
  secret_change: "Set, rotate or delete a secret. Each approval works once.",
  destructive: "Delete branches or data, force-push or drop tables. Each approval works once.",
  spend: "Buy or scale up paid resources. Each approval works once.",
  external_comms: "Post publicly or email customers.",
  prompt_approval: "Approve or deny one pending permission request from an agent session.",
  config_change: "Change an agent session's own permissions, instructions or settings. Each approval works once.",
};

/** relay-control DelegateGrant (GET|POST /workspaces/{id}/delegates, DELETE /delegates/{grantId}). */
export const delegateGrantSchema = z.object({
  grant_id: z.string(),
  owner_id: z.string(),
  delegate_agent_id: z.string(),
  scopes: z.array(z.object({ class: z.string(), targets: z.array(z.string()) })),
  require_tier_o: z.array(z.string()),
  expires_at: z.string(),
  status: z.string(),
  /** Set on a grant the owner's trust rule created: it covers every class the policy allows, with `scopes: []`. */
  trust_rule_id: z.string().nullable().optional(),
});
export type DelegateGrant = z.infer<typeof delegateGrantSchema>;
export const delegateGrantsSchema = z.object({ grants: z.array(delegateGrantSchema) });
/** POST /delegates/claims: a one-time code, shown once. */
export const delegateClaimSchema = z.object({
  claim_id: z.string(),
  code: z.string(),
  expires_at: z.string(),
});
export type DelegateClaim = z.infer<typeof delegateClaimSchema>;
/** POST /delegates/revoke-all: the revoked grant ids. */
export const revokedGrantsSchema = z.object({ revoked: z.array(z.string()) });

/**
 * relay-control GET|PUT|DELETE /workspaces/{id}/delegates/trust-rule (the
 * twin of Cloud's route): the caller's own set-once trust rule, the agents it
 * covers now with the root they were proven through, and the bots whose own
 * grant wins over it.
 */
export const trustRuleSchema = z.object({
  trust_rule_id: z.string(),
  created_at: z.string(),
});
export const trustRuleStateSchema = z.object({
  rule: trustRuleSchema.nullable(),
  covered: z.array(z.object({
    grant_id: z.string(),
    delegate_agent_id: z.string(),
    root_kind: z.enum(["claim", "connector"]).nullable(),
    connector: z.string().nullable(),
    root_agent_id: z.string().nullable(),
    launched_by: z.string().nullable(),
    hops: z.number().int().nonnegative(),
  })).default([]),
  shadowed: z.array(z.object({ grant_id: z.string(), delegate_agent_id: z.string() })).default([]),
});
export type TrustRuleState = z.infer<typeof trustRuleStateSchema>;
export type TrustRuleCovered = TrustRuleState["covered"][number];
export const trustRulePutSchema = z.object({ rule: trustRuleSchema });
