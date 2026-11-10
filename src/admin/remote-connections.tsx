import { Button } from "../shell/ui";
import { adminApi } from "./api";
import { FactoryConnectionSection } from "./factory-connection";
import { RemoteKeyConnectionCard } from "./remote-key-connection";
import { message, useLoad } from "./use-load";

/** Mirrors Control's provider registry and never fetches disabled providers. */
export function RemoteConnectionsSection({ workspaceId, canManage }: {
  workspaceId: string; canManage: boolean;
}) {
  return <RemoteConnections key={workspaceId} workspaceId={workspaceId} canManage={canManage} />;
}

function RemoteConnections({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const { data, error, reload } = useLoad((signal) => adminApi.remoteProviders(workspaceId, signal));
  const enabled = (id: string) => data?.providers.some((provider) => provider.id === id && provider.enabled && provider.implemented && provider.setup === "api_key");
  return <>
    {error && <p role="alert">Couldn’t check remote agent connections. {message(error)} <Button variant="outline" size="sm" onClick={reload}>Try again</Button></p>}
    {enabled("factory") && <FactoryConnectionSection workspaceId={workspaceId} canManage={canManage} />}
    {(["capy", "replicas"] as const).filter(enabled).map((provider) => <RemoteKeyConnectionCard key={`${workspaceId}:${provider}`} provider={provider} workspaceId={workspaceId} canManage={canManage} />)}
  </>;
}
