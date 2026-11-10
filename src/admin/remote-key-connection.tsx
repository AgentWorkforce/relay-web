import { useState, type FormEvent } from "react";
import { Button, Input } from "../shell/ui";
import { adminApi, ApiError } from "./api";
import { DashboardPanel } from "./coding-agents";
import type { RemoteKeyConnection } from "./contracts";
import { formatDate, message, useLoad } from "./use-load";

const providers = {
  capy: {
    label: "Capy", placeholder: "capy_…",
    description: "Connect Capy so Relay messages can reach your bound Capy threads.",
    help: "Use a dedicated Capy service-user key with read_write access limited to the projects your agents use and a monthly spend cap. For threads on your computer, the device’s Access must be Shared in Capy.",
    get: adminApi.capyConnection, connect: adminApi.connectCapy, disconnect: adminApi.disconnectCapy,
  },
  replicas: {
    label: "Replicas", placeholder: "Paste API key",
    description: "Connect your Replicas account for Relay agents using your environments.",
    help: "Create a dedicated Replicas API key with access to the environments your agents use.",
    get: adminApi.replicasConnection, connect: adminApi.connectReplicas, disconnect: adminApi.disconnectReplicas,
  },
} as const;

/** The hosted connection cards' write-only key flow, using Control's cookie API. */
export function RemoteKeyConnectionCard({ provider, workspaceId, canManage }: {
  provider: keyof typeof providers; workspaceId: string; canManage: boolean;
}) {
  const config = providers[provider];
  const { data, error, reload } = useLoad((signal) => config.get(workspaceId, signal));
  const [snapshot, setSnapshot] = useState<RemoteKeyConnection | null>(null);
  const [connection, setConnection] = useState<RemoteKeyConnection | null>(null);
  if (snapshot !== data) { setSnapshot(data); setConnection(data); }
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy || !canManage || !key.trim()) return;
    const submitted = key.trim();
    setKey(""); setBusy(true); setFailure(null);
    try { setConnection(await config.connect(workspaceId, submitted)); }
    catch (error) {
      // Replicas preserves Cloud's human-readable `error` field rather than a code.
      const detail = provider === "replicas" && error instanceof ApiError && error.code.includes(" ")
        ? error.code : message(error);
      setFailure(detail.split(submitted).join("[redacted]"));
    } finally { setBusy(false); }
  }
  async function disconnect() {
    if (!canManage || busy) return;
    setBusy(true); setFailure(null);
    try {
      await config.disconnect(workspaceId);
      setConnection({ connected: false, keyHint: null, validatedAt: null, lastError: null });
      setConfirm(false); setKey("");
    } catch (error) { setFailure(message(error)); }
    finally { setBusy(false); }
  }
  return <DashboardPanel title={config.label} description={config.description}>
    <p className="text-sm text-muted-foreground">{config.help} Control stores your key encrypted and only shows its masked ending after saving.</p>
    {!data && !error && !connection && <p role="status">Loading {config.label} connection…</p>}
    {error && <p role="alert">{message(error)} <Button variant="outline" size="sm" onClick={reload}>Try again</Button></p>}
    {connection?.connected && <div className="flex flex-wrap items-center gap-3">
      <p>Connected with <code>{connection.keyHint}</code>, checked {formatDate(connection.validatedAt)}.</p>
      {canManage && <Button variant="outline" disabled={busy} onClick={() => setConfirm(true)}>Disconnect {config.label}</Button>}
    </div>}
    {connection?.lastError && <p role="alert">{connection.lastError}</p>}
    {connection && canManage && <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void connect(event)}>
      <label className="flex min-w-64 flex-col gap-1.5" htmlFor={`${provider}-key-${workspaceId}`}>
        {connection.connected ? `Replace ${config.label} API key` : `${config.label} API key`}
        <Input id={`${provider}-key-${workspaceId}`} type="password" autoComplete="off" spellCheck={false}
          placeholder={config.placeholder} value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} />
      </label>
      <Button type="submit" disabled={busy || !key.trim()}>{busy ? "Checking…" : connection.connected ? "Replace key" : `Connect ${config.label}`}</Button>
    </form>}
    {!canManage && <p>Ask an organization owner or admin to connect {config.label}.</p>}
    {confirm && <div role="alertdialog" aria-label={`Disconnect ${config.label}`} className="flex flex-col gap-3">
      <p>Disconnect {config.label}? Relay will stop using this connection for its agents.</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void disconnect()}>Confirm disconnect</Button>
        <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button></div>
    </div>}
    {failure && <p role="alert">{failure}</p>}
  </DashboardPanel>;
}
