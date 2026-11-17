import { useEffect, useRef, useState } from "react";
import { adminApi, ApiError } from "./api";
import type { Member } from "./contracts";
import {
  remoteAgentApi,
  replicasApi,
  type RemoteProvider,
  type ReplicasEnvironment,
  type ReplicasPolicy,
  type ReplicasSpawn,
} from "./remote-agent-api";
import { formatDate, message, useLoad } from "./use-load";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from "../shell/ui";

const selectClass =
  "rounded-full border border-[var(--border-default)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs text-foreground disabled:opacity-50";

const failingStatuses = new Set([
  "registration_unconfirmed",
  "discovery_missing",
  "access_revoked",
]);

const needsRetry = (environment: ReplicasEnvironment) =>
  failingStatuses.has(environment.status) || environment.stale === true;

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

function statusLine(policy: ReplicasPolicy) {
  const environments = policy.environments;
  const total = environments.length;
  const registered = environments.filter(
    (environment) => environment.status === "registered",
  ).length;
  const failing = environments.filter(
    (environment) => environment.enabled && needsRetry(environment),
  ).length;
  const principal = policy.principal ?? null;
  let text: string;
  if (policy.organizationShared)
    text =
      "This Replicas organization is connected in another workspace. Nothing is admitted until one of them disconnects.";
  else if (policy.accessRevoked)
    text = `Replicas refused the stored API key (since ${formatDate(policy.accessRevoked.since)}). Replace the key to restore Relay setup.`;
  else if (!principal)
    text =
      "Environment setup does not grant messaging by itself. Choose the member responsible for these agents to enable automatic joining.";
  else if (!principal.member)
    text =
      "The responsible member is no longer in this organization. Choose another member to restore automatic joining.";
  else if (failing > 0)
    text = `Automatic Relay setup failed for ${failing} ${plural(failing, "environment", "environments")}. Retry setup or check the provider connection.`;
  else if (
    environments.some(
      (environment) => environment.enabled && environment.status === "enabled",
    )
  )
    text =
      "Environment Relay setup is pending; Apply Relay setup or the periodic sync will retry it.";
  else
    text =
      "Automatic Relay messaging is configured. Each mothership and ship joins as its own agent when it calls Relay.";
  return `${text} ${registered} of ${total} ${plural(total, "environment", "environments")} configured.`;
}

function statusWord(environment: ReplicasEnvironment) {
  const word =
    environment.status === "registered"
      ? "Configured"
      : environment.status === "enabled"
        ? "Pending"
        : environment.status === "registration_unconfirmed"
          ? "Registration unconfirmed"
          : environment.status === "discovery_missing"
            ? "Not listed by Replicas"
            : environment.status === "access_revoked"
              ? "Key refused"
              : environment.status === "disabled"
                ? environment.optedOut
                  ? "Opted out"
                  : "Disabled"
                : environment.status;
  return environment.stale ? `${word} · stale connection` : word;
}

const memberLabel = (member: Member) =>
  member.name?.trim() ? `${member.name} (${member.email})` : member.email;

function SpawnRow({ spawn }: { spawn: ReplicasSpawn }) {
  const rejected = spawn.rejectedMessages ?? 0;
  const uncertain = spawn.uncertainMessages ?? 0;
  const retrying = spawn.retryingMessages ?? 0;
  return (
    <li className="flex flex-col gap-1">
      <span>
        {spawn.agent ? (
          <code>@{spawn.agent}</code>
        ) : spawn.replicaId ? (
          <code>{spawn.replicaId}</code>
        ) : (
          "unassigned"
        )}
        {" · "}
        {spawn.status}
      </span>
      {spawn.error ? <p role="alert">{spawn.error}</p> : null}
      {rejected + uncertain + retrying > 0 ? (
        <p className="text-sm text-muted-foreground">
          {rejected} rejected · {uncertain} uncertain · {retrying} retrying
        </p>
      ) : null}
    </li>
  );
}

/** Mounted only while connected, keyed by the connection: a new key reloads. */
function ReplicasSetup({
  workspaceId,
  organizationId,
  canManage,
}: {
  workspaceId: string;
  organizationId?: string;
  canManage: boolean;
}) {
  const setup = useLoad(async (signal) => {
    const [policy, workspace] = await Promise.all([
      replicasApi.policies(workspaceId, signal),
      replicasApi.workspace(workspaceId, signal),
    ]);
    return { policy, spawns: workspace.spawns };
  });
  const members = useLoad<Member[] | null>((signal) =>
    canManage && organizationId
      ? adminApi.members(organizationId, signal)
      : Promise.resolve(null),
  );
  const principalId = setup.data?.policy.principal?.userId ?? "";
  const [seed, setSeed] = useState(principalId);
  const [choice, setChoice] = useState(principalId);
  if (seed !== principalId) {
    // A fresh read re-seeds the selection with the stored principal.
    setSeed(principalId);
    setChoice(principalId);
  }
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function write(
    action: string,
    work: () => Promise<unknown>,
    environmentId?: string,
  ) {
    if (pending || !canManage) return;
    setPending(action);
    setError(null);
    if (environmentId)
      setRowErrors((errors) => {
        const next = { ...errors };
        delete next[environmentId];
        return next;
      });
    try {
      await work();
    } catch (failure) {
      if (active.current) {
        const text = message(failure);
        if (environmentId)
          setRowErrors((errors) => ({ ...errors, [environmentId]: text }));
        else setError(text);
      }
    } finally {
      // Every write re-reads: a 409 (or a partial apply) leaves newer server
      // state, and useLoad keeps only the newest response.
      if (active.current) {
        setPending(null);
        setup.reload();
      }
    }
  }

  if (setup.error)
    return (
      <p role="alert">
        {message(setup.error)}{" "}
        <Button variant="outline" onClick={setup.reload}>
          Try again
        </Button>
      </p>
    );
  if (!setup.data) return <p role="status">Loading Replicas setup…</p>;
  const { policy, spawns } = setup.data;
  const principal = policy.principal ?? null;
  const memberList = members.data ?? [];
  // Keep a stored principal who left the organization visible in the select.
  const formerPrincipalId =
    principal && members.data &&
    !members.data.some((member) => member.userId === principal.userId)
      ? principal.userId
      : null;
  const selectId = `replicas-principal-${workspaceId}`;
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm">
        {statusLine(policy)}
      </p>
      {canManage && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void write("apply", async () => {
              await replicasApi.setPrincipal(workspaceId, choice || null);
              await replicasApi.sync(workspaceId);
            });
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-64 flex-col gap-1.5" htmlFor={selectId}>
              Member responsible for Replicas agents
              <select
                id={selectId}
                className={selectClass}
                value={choice}
                disabled={pending !== null}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">No default principal</option>
                {memberList.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {memberLabel(member)}
                  </option>
                ))}
                {formerPrincipalId && (
                  <option value={formerPrincipalId} disabled>
                    Former member
                  </option>
                )}
              </select>
            </label>
            <Button type="submit" disabled={pending !== null}>
              {pending === "apply" ? "Working…" : "Apply Relay setup"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            This member controls messaging for unmapped and provider-created
            VMs, including ships. Clearing it blocks those VMs; explicit creator
            mappings still apply.
          </p>
          {members.error && <p role="alert">{message(members.error)}</p>}
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      <div className="flex flex-col gap-2">
        <h4 className="font-medium">Environments</h4>
        {policy.environments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No environments discovered yet. Apply Relay setup to discover them.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {policy.environments.map((environment) => {
              const id = environment.environmentId;
              const bindings = environment.bindings ?? 0;
              const unmapped = environment.pendingCreators?.length ?? 0;
              const rowError = rowErrors[id];
              return (
                <li key={id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex flex-col">
                      <span>{environment.name || id}</span>
                      <small className="text-xs text-muted-foreground">
                        {id}
                      </small>
                    </span>
                    <span className="text-sm">{statusWord(environment)}</span>
                    {bindings > 0 && (
                      <span className="text-sm text-muted-foreground">
                        {bindings} bound
                      </span>
                    )}
                    {unmapped > 0 && (
                      <span className="text-sm text-muted-foreground">
                        {unmapped} unmapped{" "}
                        {plural(unmapped, "creator", "creators")}
                      </span>
                    )}
                    {canManage && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending !== null}
                          onClick={() =>
                            void write(
                              `toggle:${id}`,
                              () =>
                                replicasApi.updateEnvironment(workspaceId, id, {
                                  enabled: !environment.enabled,
                                }),
                              id,
                            )
                          }
                        >
                          {pending === `toggle:${id}`
                            ? "Working…"
                            : environment.enabled
                              ? "Opt out"
                              : "Enable"}
                        </Button>
                        {needsRetry(environment) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending !== null}
                            onClick={() =>
                              void write(
                                `retry:${id}`,
                                () =>
                                  replicasApi.updateEnvironment(
                                    workspaceId,
                                    id,
                                    { retry_registration: true },
                                  ),
                                id,
                              )
                            }
                          >
                            {pending === `retry:${id}` ? "Working…" : "Retry"}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {rowError && <p role="alert">{rowError}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="font-medium">Replica bindings</h4>
        {spawns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No replica bindings yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {spawns.map((spawn) => (
              <SpawnRow key={spawn.id} spawn={spawn} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ReplicasConnectionCard({
  provider,
  workspaceId,
  organizationId,
  canManage,
  onConflict,
  readRevision,
  currentReadRevision,
}: {
  provider: RemoteProvider;
  workspaceId: string;
  organizationId?: string;
  canManage: boolean;
  onConflict(): void;
  readRevision: number;
  currentReadRevision(): number;
}) {
  const [connection, setConnection] = useState(provider.connection);
  const [snapshot, setSnapshot] = useState(provider);
  const [lastWriteRead, setLastWriteRead] = useState(0);
  if (snapshot !== provider) {
    setSnapshot(provider);
    // Reads begun before the latest confirmed mutation cannot replace it.
    if (readRevision > lastWriteRead) setConnection(provider.connection);
  }
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const manageable = canManage && provider.capabilities.connectionManagement;
  async function change(disconnect = false) {
    if (pending || !manageable) return;
    const submitted = key;
    setPending(true);
    setError(null);
    setKey("");
    try {
      const result = disconnect
        ? (await remoteAgentApi.disconnect(workspaceId, "replicas"), null)
        : (await remoteAgentApi.connect(workspaceId, "replicas", submitted))
            .connection;
      if (active.current) {
        setLastWriteRead(currentReadRevision());
        setConnection(result);
      }
    } catch (error) {
      if (active.current) {
        setError(message(error));
        if (error instanceof ApiError && error.status === 409) onConflict();
      }
    } finally {
      if (active.current) setPending(false);
    }
  }
  const keyId = `replicas-key-${workspaceId}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Replicas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Connect Replicas so agents can launch replicas and exchange Relay
          messages through this installation. Create a dedicated Replicas API
          key with access to the environments your agents use. The key is
          stored encrypted. Relay setup is automatic for those environments; no
          Relay workspace key is needed.
        </p>
        {connection && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">
                Connected with <code>{connection.keyHint}</code>, checked{" "}
                {formatDate(connection.validatedAt)}.
              </p>
              {manageable && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void change(true)}
                >
                  Disconnect
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Disconnect revokes every replica's Relay access. Reconnecting
              requires explicitly restoring each previous VM.
            </p>
            <ReplicasSetup
              key={`${connection.keyHint}:${connection.validatedAt}`}
              workspaceId={workspaceId}
              organizationId={organizationId}
              canManage={canManage}
            />
          </>
        )}
        {manageable ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void change();
            }}
          >
            <label className="flex min-w-64 flex-col gap-1.5" htmlFor={keyId}>
              {connection ? "Replace Replicas API key" : "Replicas API key"}
              <Input
                id={keyId}
                type="password"
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={pending || !key.trim()}>
              {pending ? "Working…" : connection ? "Replace" : "Connect"}
            </Button>
          </form>
        ) : (
          !connection && (
            <p>Ask an organization owner or admin to connect Replicas.</p>
          )
        )}
        {error && <p role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
