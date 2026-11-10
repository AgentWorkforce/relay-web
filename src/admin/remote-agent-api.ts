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
