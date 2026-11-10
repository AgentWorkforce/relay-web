import { useEffect, useRef, useState } from "react";
import { AmpConnectionCard } from "./amp-connection-card";
import { FactoryConnectionSection } from "./factory-connection";
import { remoteAgentApi, type RemoteProvider } from "./remote-agent-api";
import { useLoad, message } from "./use-load";
import { ApiError } from "./api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from "../shell/ui";

function RemoteConnectionCard({
  provider,
  workspaceId,
  canManage,
  onConflict,
}: {
  provider: RemoteProvider;
  workspaceId: string;
  canManage: boolean;
  onConflict(): void;
}) {
  const [connection, setConnection] = useState(provider.connection);
  const [snapshot, setSnapshot] = useState(provider);
  if (snapshot !== provider) {
    setSnapshot(provider);
    setConnection(provider.connection);
  }
  const [key, setKey] = useState("");
  const [orgId, setOrgId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function change(disconnect = false) {
    if (pending || !canManage || !provider.capabilities.connectionManagement)
      return;
    setPending(true);
    setError(null);
    setKey("");
    try {
      const result = disconnect
        ? (await remoteAgentApi.disconnect(workspaceId, provider.id), null)
        : (await remoteAgentApi.connect(workspaceId, provider.id, key, orgId))
            .connection;
      if (active.current) setConnection(result);
    } catch (error) {
      if (active.current) {
        setError(message(error));
        if (error instanceof ApiError && error.status === 409) onConflict();
      }
    } finally {
      if (active.current) setPending(false);
    }
  }
  const keyId = `${provider.id}-key-${workspaceId}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{provider.product}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Connect your workspace’s {provider.product} API key.
        </p>
        {connection && (
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Connected with <code>{connection.keyHint}</code>
            </span>
            {canManage && <Button
              variant="outline"
              disabled={pending}
              onClick={() => void change(true)}
            >
              Disconnect
            </Button>}
          </div>
        )}
        {canManage && provider.capabilities.connectionManagement ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void change();
            }}
          >
            <label className="flex min-w-64 flex-col gap-1.5" htmlFor={keyId}>
              {connection
                ? `Replace ${provider.product} API key`
                : `${provider.product} API key`}
              <Input
                id={keyId}
                type="password"
                autoComplete="new-password"
                data-1p-ignore="true"
                data-lpignore="true"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            {provider.id === "devin" && (
              <label className="flex flex-col gap-1.5">
                Cognition organization ID
                <Input
                  value={orgId}
                  onChange={(event) => setOrgId(event.target.value)}
                />
              </label>
            )}
            <Button
              type="submit"
              disabled={
                pending ||
                !key.trim() ||
                (provider.id === "devin" && !orgId.trim())
              }
            >
              {pending ? "Working…" : "Connect"}
            </Button>
          </form>
        ) : (
          <p>Ask an organization owner or admin to manage this connection.</p>
        )}
        {(!provider.capabilities.relayBinding ||
          !provider.capabilities.historySync) && (
          <p className="text-sm text-muted-foreground">
            {provider.capabilities.relayBinding
              ? ""
              : "Relay thread connections and launches are not available on this installation yet. "}
            {provider.capabilities.historySync
              ? ""
              : "History sync is not available yet. Saving a key does not upload conversations."}
          </p>
        )}
        {pending && <p role="status">Checking {provider.product}…</p>}
        {error && <p role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}

function AmpSettings({ workspaceId }: { workspaceId: string }) {
  const { data, error, reload } = useLoad((signal) =>
    remoteAgentApi.amp(workspaceId, signal),
  );
  if (error)
    return (
      <p role="alert">
        {message(error)}{" "}
        <Button variant="outline" onClick={reload}>
          Try again
        </Button>
      </p>
    );
  if (!data) return <p role="status">Loading Amp…</p>;
  return (
    <AmpConnectionCard
      workspaceId={workspaceId}
      initial={data}
      canManage
      action={remoteAgentApi.ampAction}
      mcpUrl={`${window.location.origin}/cloud/api/v1/mcp/shared-sessions`}
    />
  );
}

/** Workspace-keyed by the parent: old requests, drafts and secrets never cross scopes. */
export function RemoteAgentsSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const { data: catalog, error: catalogError } = useLoad((signal) =>
    remoteAgentApi.providers(workspaceId, signal),
  );
  const { data, error, reload } = useLoad((signal) =>
    remoteAgentApi.connections(workspaceId, signal),
  );
  const amp = catalog?.providers.find((provider) => provider.id === "amp");
  const factory = catalog?.providers.find((provider) => provider.id === "factory");
  const unavailable = error instanceof ApiError && error.status === 404 && error.code === "not_found";
  return (
    <section aria-label="Remote coding agents" className="flex flex-col gap-6">
      <header>
        <h2>Remote coding agents</h2>
        <p>Connect the remote agents your workspace uses.</p>
      </header>
      {amp?.implemented && amp.enabled && amp.configured && canManage ? (
        <AmpSettings workspaceId={workspaceId} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Amp</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              {!canManage
                ? "Ask an organization owner or admin to manage Amp."
                : catalogError
                  ? "Amp availability could not be checked."
                  : !catalog
                    ? "Checking Amp availability…"
                    : "Amp is not enabled and configured on this installation. Contact your administrator."}
            </p>
          </CardContent>
        </Card>
      )}
      {factory?.implemented && factory.enabled && (
        <FactoryConnectionSection workspaceId={workspaceId} canManage={canManage} />
      )}
      {data?.providers.map((provider) => (
        <RemoteConnectionCard
          key={`${workspaceId}:${provider.id}`}
          workspaceId={workspaceId}
          provider={provider}
          canManage={canManage}
          onConflict={reload}
        />
      ))}
      {!data && !error && (
        <p role="status">Loading remote provider connections…</p>
      )}
      {unavailable ? (
        <p>
          Remote provider connection settings are not available on this server
          version.
        </p>
      ) : (
        error && (
          <p role="alert">
            {message(error)}{" "}
            <Button variant="outline" onClick={reload}>
              Try again
            </Button>
          </p>
        )
      )}
    </section>
  );
}
