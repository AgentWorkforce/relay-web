import { z } from "zod";
import { SignedOut } from "../api/client";

const decisionSchema = z.object({
  evidenceDigest: z.string(),
  kind: z.string(),
  outcome: z.string(),
  reason: z.string(),
  taskId: z.string().optional(),
});
export const chiefSchema = z.object({
  id: z.string(),
  name: z.string(),
  repository: z.string(),
  repositories: z.array(z.string()).optional(),
  mode: z.enum(["local", "plan_only"]),
  status: z.string(),
  scanStatus: z.string(),
  createdAt: z.string(),
  lastScanAt: z.string().nullable(),
  region: z.string(),
  budgetDollars: z.number(),
  maxConcurrentTasks: z.number(),
  allowedActions: z.array(z.string()),
  accounting: z.object({
    knownCostMicros: z.number(),
    unknownCostEvents: z.number(),
    events: z.number(),
    committedReservationMicros: z.number(),
  }),
  tasks: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      status: z.string(),
      title: z.string(),
      worker: z.string(),
      verified: z.boolean(),
      checks: z.array(z.string()),
    }),
  ),
  decisions: z.array(decisionSchema),
  setupSteps: z.array(z.object({ label: z.string(), complete: z.boolean() })),
});
const listSchema = z.object({
  mode: z.enum(["local", "plan_only"]),
  chiefs: z.array(chiefSchema),
});
export type ProjectChief = z.infer<typeof chiefSchema>;
export type ChiefList = z.infer<typeof listSchema>;
export interface SetupInput {
  requestId: string;
  repositoryIds: string[];
  region: string;
  budgetDollars: number;
  maxConcurrentTasks: number;
  allowedActions: string[];
}
const githubRepositorySchema = z.object({
  id: z.string(),
  fullName: z.string(),
  private: z.boolean(),
});
const repositoryCatalogSchema = z.object({
  connected: z.boolean(),
  repositories: z.array(githubRepositorySchema),
});
export type GithubRepository = z.infer<typeof githubRepositorySchema>;
export type RepositoryCatalog = z.infer<typeof repositoryCatalogSchema>;
/** The server refused this person or installation: retrying won't change it. */
export class ChiefRefused extends Error {}

function refusalMessage(body: { error?: string; message?: string } | null) {
  if (body?.error === "feature_not_enabled")
    return "Chief is not enabled on this installation.";
  return body?.message?.trim() || "You don't have permission to do that.";
}

async function call<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`/cloud/api${path}`, {
    method: options.body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: options.signal,
    headers: {
      accept: "application/json",
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  if (response.status === 401) throw new SignedOut();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    if (response.status === 403 && body?.error !== "repository_access_changed" && body?.error !== "github_disconnected")
      throw new ChiefRefused(refusalMessage(body));
    throw new Error(
      body?.error === "repository_access_changed" ||
        body?.error === "github_disconnected"
        ? "GitHub access changed. Go back to Project, refresh repositories, and select again."
        : body?.error === "project_already_configured"
          ? "This repository already has a chief. Return to your chiefs to open it."
          : response.status === 503
            ? "Chief setup is not available on this installation yet."
            : "Could not complete the request. Please try again.",
    );
  }
  return schema.parse(await response.json());
}
const path = (workspace: string) =>
  `/v1/workspaces/${encodeURIComponent(workspace)}/chiefs`;
export const chiefApi = {
  repositories: (workspace: string, signal: AbortSignal) =>
    call(`${path(workspace)}/repositories`, repositoryCatalogSchema, {
      signal,
    }),
  list: (workspace: string, signal: AbortSignal) =>
    call(path(workspace), listSchema, { signal }),
  create: (workspace: string, body: SetupInput) =>
    call(path(workspace), chiefSchema, { body }),
  scan: (workspace: string, id: string) =>
    call(`${path(workspace)}/${encodeURIComponent(id)}/scan`, chiefSchema, {
      body: {},
    }),
};
