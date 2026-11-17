import { z } from "zod";
import { adminRequest } from "./api";
import type { AmpAction, AmpActionResult } from "./amp-types";
import { message } from "./use-load";

const connectionSchema = z.object({
  keyHint: z.string(),
  validatedAt: z.string(),
  providerAccount: z.string().nullable(),
});
const remoteProviderIds = ["capy", "replicas", "devin", "cursor-cloud"] as const;
const remoteProviderSchema = z.object({
  id: z.enum(remoteProviderIds),
  product: z.string(),
  docsUrl: z.string().url(),
  connection: connectionSchema.nullable(),
  capabilities: z.object({
    connectionManagement: z.boolean(),
    relayBinding: z.boolean(),
    historySync: z.boolean(),
  }),
});
export const remoteConnectionsSchema = z.object({
  // Control and the dashboard deploy independently. New provider rows may have
  // a different shape, so identify and drop them before validating known rows.
  providers: z.array(z.object({ id: z.string() }).passthrough()).transform((rows) =>
    rows.filter((row) => remoteProviderIds.some((id) => id === row.id))
      .map((row) => remoteProviderSchema.parse(row))),
});
export type RemoteProvider = z.infer<
  typeof remoteConnectionsSchema
>["providers"][number];
export const providerStatusSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      product: z.string(),
      implemented: z.boolean(),
      configured: z.boolean(),
      enabled: z.boolean(),
    }),
  ),
});
export const ampViewSchema = z.object({
  connection: z
    .object({ keyHint: z.string(), validatedAt: z.string().nullable() })
    .nullable(),
  history: z
    .object({ available: z.boolean(), reason: z.string().optional() })
    .optional(),
  bindings: z.array(
    z.object({
      id: z.string(),
      threadId: z.string(),
      agentName: z.string(),
      state: z.string(),
      lastError: z.string().nullable(),
      deliveries: z.array(
        z.object({ messageId: z.string(), state: z.string() }),
      ),
    }),
  ),
});
const threadsSchema = z.object({
  threads: z.array(z.object({ id: z.string(), title: z.string() })),
});
const base = (workspace: string) =>
  `/v1/workspaces/${encodeURIComponent(workspace)}`;

export const remoteAgentApi = {
  providers: (workspace: string, signal?: AbortSignal) =>
    adminRequest(`${base(workspace)}/providers`, providerStatusSchema, {
      signal,
    }),
  connections: (workspace: string, signal?: AbortSignal) =>
    adminRequest(
      `${base(workspace)}/remote-agent-connections`,
      remoteConnectionsSchema,
      { signal },
    ),
  connect: (
    workspace: string,
    provider: RemoteProvider["id"],
    key: string,
    orgId?: string,
  ) =>
    adminRequest(
      `${base(workspace)}/remote-agent-connections/${provider}`,
      z.object({ connection: connectionSchema }),
      {
        method: "POST",
        body: { key, ...(orgId ? { orgId } : {}) },
      },
    ),
  disconnect: (workspace: string, provider: RemoteProvider["id"]) =>
    adminRequest(
      `${base(workspace)}/remote-agent-connections/${provider}`,
      null,
      { method: "DELETE" },
    ),
  amp: (workspace: string, signal?: AbortSignal) =>
    adminRequest(`${base(workspace)}/amp`, ampViewSchema, { signal }),
  async ampAction(
    workspace: string,
    action: AmpAction,
  ): Promise<AmpActionResult> {
    const path = `${base(workspace)}/amp`;
    try {
      let threads: z.infer<typeof threadsSchema>["threads"] | undefined;
      if (action.kind === "connect") {
        const connected = await adminRequest(
          `${path}/connection`,
          ampViewSchema.extend({
            threads: threadsSchema.shape.threads.optional(),
          }),
          {
            method: "POST",
            body: { key: action.key },
          },
        );
        return { ok: true, ...connected };
      }
      if (action.kind === "discover")
        threads = (await adminRequest(`${path}/threads`, threadsSchema))
          .threads;
      if (action.kind === "disconnect")
        await adminRequest(`${path}/connection`, null, { method: "DELETE" });
      if (action.kind === "bind")
        await adminRequest(`${path}/bindings`, null, {
          method: "POST",
          body: { threadId: action.threadId },
        });
      if (action.kind === "unbind")
        await adminRequest(
          `${path}/bindings/${encodeURIComponent(action.id)}`,
          null,
          { method: "DELETE" },
        );
      if (action.kind === "check_delivery")
        await adminRequest(
          `${path}/bindings/${encodeURIComponent(action.id)}/deliveries/${encodeURIComponent(action.messageId)}/check`,
          null,
          { method: "POST", body: {} },
        );
      return {
        ok: true,
        ...(await remoteAgentApi.amp(workspace)),
        ...(threads ? { threads } : {}),
      };
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  },
};

// Replicas setup. Status strings stay open (z.string()) so a newer Control can
// add states without breaking this dashboard; unknown fields are stripped.
const replicasEnvironmentSchema = z.object({
  environmentId: z.string(),
  name: z.string().nullable().optional(),
  enabled: z.boolean(),
  status: z.string(),
  discoveryMissingSince: z.string().nullable().optional(),
  optedOut: z.boolean().optional(),
  stale: z.boolean().optional(),
  registeredMcpId: z.string().nullable().optional(),
  bindings: z.number().optional(),
  creators: z
    .array(
      z.object({
        creatorId: z.string(),
        userId: z.string().nullable().optional(),
        emailHint: z.string().nullable().optional(),
      }),
    )
    .optional(),
  pendingCreators: z
    .array(
      z.object({
        creatorId: z.string(),
        emailHint: z.string().nullable().optional(),
        lastSeenAt: z.string().nullable().optional(),
        count: z.number().optional(),
      }),
    )
    .optional(),
});
export type ReplicasEnvironment = z.infer<typeof replicasEnvironmentSchema>;
export const replicasPolicySchema = z.object({
  mcpUrl: z.string().optional(),
  organizationId: z.string().nullable().optional(),
  accessRevoked: z
    .object({ since: z.string(), error: z.string().nullable().optional() })
    .nullable()
    .optional(),
  allEnvironments: z.boolean().optional(),
  principal: z
    .object({ userId: z.string(), member: z.boolean() })
    .nullable()
    .optional(),
  organizationShared: z.boolean().optional(),
  environments: z.array(replicasEnvironmentSchema),
});
export type ReplicasPolicy = z.infer<typeof replicasPolicySchema>;
export const replicasWorkspaceSchema = z.object({
  connection: z
    .object({
      keyHint: z.string(),
      organizationId: z.string().nullable().optional(),
      validatedAt: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  spawns: z.array(
    z.object({
      id: z.string(),
      agent: z.string().nullable().optional(),
      replicaId: z.string().nullable().optional(),
      status: z.string(),
      error: z.string().nullable().optional(),
      provisioning_error: z
        .object({
          code: z.string().optional(),
          stage: z.string().optional(),
          retryable: z.boolean().optional(),
        })
        .nullable()
        .optional(),
      uncertainMessages: z.number().optional(),
      rejectedMessages: z.number().optional(),
      retryingMessages: z.number().optional(),
    }),
  ),
});
export type ReplicasSpawn = z.infer<
  typeof replicasWorkspaceSchema
>["spawns"][number];
const replicasSyncSchema = z.object({
  discovery: z
    .object({ status: z.string() })
    .nullable()
    .optional(),
  allEnvironments: z.boolean().optional(),
  environments: z
    .array(
      z.object({
        environmentId: z.string(),
        status: z.string(),
        retryable: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const replicasApi = {
  workspace: (workspace: string, signal?: AbortSignal) =>
    adminRequest(`${base(workspace)}/replicas`, replicasWorkspaceSchema, {
      signal,
    }),
  policies: (workspace: string, signal?: AbortSignal) =>
    adminRequest(
      `${base(workspace)}/replicas/environment-policies`,
      replicasPolicySchema,
      { signal },
    ),
  sync: (workspace: string) =>
    adminRequest(
      `${base(workspace)}/replicas/environments/sync`,
      replicasSyncSchema,
      { method: "POST", body: {} },
    ),
  updateEnvironment: (
    workspace: string,
    environmentId: string,
    body: { enabled: boolean } | { retry_registration: true },
  ) =>
    adminRequest(
      `${base(workspace)}/replicas/environments/${encodeURIComponent(environmentId)}`,
      null,
      { method: "PUT", body },
    ),
  setPrincipal: (workspace: string, userId: string | null) =>
    adminRequest(
      `${base(workspace)}/replicas/environment-principal`,
      replicasPolicySchema,
      { method: "PUT", body: { userId } },
    ),
};
