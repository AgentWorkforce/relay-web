import { useState, type FormEvent } from "react";
import { Button, Input } from "../shell/ui";
import { adminApi } from "./api";
import { DashboardPanel } from "./coding-agents";
import type { FactoryConnection } from "./contracts";
import { formatDate, message, useLoad } from "./use-load";

/** Factory is user-owned, unlike the workspace's model-provider credentials. */
export function FactoryConnectionSection({ workspaceId, canManage }: {
  workspaceId: string; canManage: boolean;
}) {
  // Control admits only owners/admins. Members never fetch another user's key settings.
  return canManage ? <FactoryConnectionCard key={workspaceId} workspaceId={workspaceId} /> : null;
}

function FactoryConnectionCard({ workspaceId }: { workspaceId: string }) {
  const { data, error, reload } = useLoad((signal) => adminApi.factoryConnection(workspaceId, signal));
  const [snapshot, setSnapshot] = useState<FactoryConnection | null>(null);
  const [connection, setConnection] = useState<FactoryConnection | null>(null);
  if (data !== snapshot) { setSnapshot(data); setConnection(data); }
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // A disabled Factory route returns 404. Do not offer a form that cannot work.
  if (!connection && !error) return null;
  const owned = !connection?.connected || connection.user_is_owner;

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy || !owned || !key.trim()) return;
    const submitted = key.trim();
    setKey(""); setBusy(true); setFailure(null);
    try { setConnection(await adminApi.connectFactory(workspaceId, submitted)); }
    catch (error) { setFailure(message(error).split(submitted).join("[redacted]")); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setFailure(null);
    try {
      await adminApi.disconnectFactory(workspaceId);
      setConnection({ connected: false, key_hint: null, validated_at: null,
        user_is_owner: false, bindings_count: 0, history: "deferred" });
      setConfirmDisconnect(false); setKey("");
    } catch (error) { setFailure(message(error)); }
    finally { setBusy(false); }
  }
  return <DashboardPanel title="Factory" description="Connect your Factory account to exchange Relay messages with existing Droid sessions.">
    <p className="text-sm text-muted-foreground">Your API key is stored encrypted by Control. After saving, only its masked ending is shown.</p>
    {error && <p role="alert">{message(error)} <Button variant="outline" size="sm" onClick={reload}>Try again</Button></p>}
    {connection?.connected && <div className="flex flex-wrap items-center gap-3">
      <p>Connected with <code>{connection.key_hint}</code>, checked {formatDate(connection.validated_at)}.</p>
      {connection.user_is_owner && <Button variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Disconnect Factory</Button>}
    </div>}
    {connection && owned && <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void connect(event)}>
      <label className="flex min-w-64 flex-col gap-1.5" htmlFor={`factory-key-${workspaceId}`}>
        {connection.connected ? "Replace Factory API key" : "Factory API key"}
        <Input id={`factory-key-${workspaceId}`} type="password" autoComplete="off" spellCheck={false}
          placeholder="fk-…" value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} />
      </label>
      <Button type="submit" disabled={busy || !key.trim()}>{busy ? "Checking…" : connection.connected ? "Replace key" : "Connect Factory"}</Button>
    </form>}
    {connection?.connected && !connection.user_is_owner && <p>Only the person who connected Factory can manage its key and sessions.</p>}
    {confirmDisconnect && <div role="alertdialog" aria-label="Disconnect Factory" className="flex flex-col gap-3">
      <p>Disconnect Factory and remove its Relay session bindings? Your Factory chats will stay in Factory.</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void disconnect()}>Confirm disconnect</Button>
        <Button variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Cancel</Button></div>
    </div>}
    {failure && <p role="alert">{failure}</p>}
    {connection?.connected && connection.user_is_owner && <FactorySessions key={`${connection.key_hint}:${connection.validated_at}`} workspaceId={workspaceId} />}
  </DashboardPanel>;
}

function FactorySessions({ workspaceId }: { workspaceId: string }) {
  const computers = useLoad((signal) => adminApi.factoryComputers(workspaceId, signal));
  const bindings = useLoad((signal) => adminApi.factoryBindings(workspaceId, signal));
  const [computer, setComputer] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const connected = bindings.data?.bindings.filter((binding) => binding.state === "bound") ?? [];
  function changed() { computers.reload(); bindings.reload(); setRevision((v) => v + 1); }
  async function unbind(id: string) {
    setRemoving(id); setFailure(null);
    try { await adminApi.unbindFactory(workspaceId, id); changed(); }
    catch (error) { setFailure(message(error)); }
    finally { setRemoving(null); }
  }
  return <div className="flex flex-col gap-3">
    <h3 className="font-semibold">Connected sessions</h3>
    <p className="text-sm text-muted-foreground">For this Mac, keep Factory open with Settings → Droid Computers → Remote Control connected. Connecting a session lets Relay messages start a turn in that chat.</p>
    {bindings.error && <p role="alert">{message(bindings.error)} <Button variant="outline" size="sm" onClick={bindings.reload}>Try again</Button></p>}
    {!bindings.data && !bindings.error && <p role="status">Loading Factory sessions…</p>}
    {bindings.data && <>
      {connected.length === 0 ? <p>No Factory sessions connected yet.</p> : <ul className="flex flex-col gap-2">
        {connected.map((binding) => <li key={binding.id} className="flex flex-wrap items-center gap-3">
          <span>{binding.agent.name ? <code>@{binding.agent.name}</code> : "Factory session"} · {binding.state}</span>
          <Button variant="outline" size="sm" aria-label={`Disconnect ${binding.agent.name ? `@${binding.agent.name}` : "Factory session"}`} disabled={removing !== null || bindingBusy} onClick={() => void unbind(binding.id)}>Disconnect session</Button>
        </li>)}
      </ul>}
    </>}
    {computers.error && <p role="alert">{message(computers.error)} <Button variant="outline" size="sm" onClick={computers.reload}>Try again</Button></p>}
    {!computers.data && !computers.error && <p role="status">Loading Factory computers…</p>}
    {computers.data && <>
      <label className="flex max-w-md flex-col gap-1.5">Computer
        <select value={computer} disabled={bindingBusy || removing !== null} onChange={(event) => { if (!bindingBusy && removing === null) setComputer(event.target.value); }}>
          <option value="">Choose your computer</option>
          {computers.data.computers.map((item) => <option key={item.id} value={item.id} disabled={item.status !== "active"}>{item.name} · {item.status}</option>)}
        </select>
      </label>
      {computers.data.computers.length === 0 && <p>No computers found for this Factory key.</p>}
      {computer && <FactorySessionPicker key={`${computer}:${revision}`} workspaceId={workspaceId} computer={computer} onBound={changed} onPending={setBindingBusy} />}
    </>}
    <p className="text-sm text-muted-foreground">Factory transcript history is not available through this connection yet.</p>
    {failure && <p role="alert">{failure}</p>}
  </div>;
}

function FactorySessionPicker({ workspaceId, computer, onBound, onPending }: {
  workspaceId: string; computer: string; onBound(): void; onPending(pending: boolean): void;
}) {
  const { data, error, reload } = useLoad((signal) => adminApi.factorySessions(workspaceId, computer, signal));
  const [session, setSession] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function bind(event: FormEvent) {
    event.preventDefault();
    if (busy || !data?.sessions.some((item) => item.id === session && item.bound === null && item.computer_id === computer)) return;
    setBusy(true); onPending(true); setFailure(null);
    try { await adminApi.bindFactory(workspaceId, session, computer); onBound(); }
    catch (error) { setFailure(message(error)); }
    finally { setBusy(false); onPending(false); }
  }
  return <div className="flex flex-col gap-3">
    {error && <p role="alert">{message(error)} <Button variant="outline" size="sm" onClick={reload}>Try again</Button></p>}
    {data?.warning && <p role="alert">{data.warning}</p>}
    {!data && !error && <p role="status">Loading sessions on this computer…</p>}
    {data && <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void bind(event)}>
      <label className="flex min-w-64 flex-col gap-1.5">Factory session
        <select value={session} disabled={busy} onChange={(event) => setSession(event.target.value)}>
          <option value="">Choose an existing session</option>
          {data.sessions.map((item) => <option key={item.id} value={item.id} disabled={item.bound !== null || item.computer_id !== computer}>
            {item.title}{item.bound === "here" ? " · connected" : item.bound === "elsewhere" ? " · connected elsewhere" : ""}
          </option>)}
        </select>
      </label>
      <Button type="submit" disabled={busy || !session || !data.sessions.some((item) => item.id === session && item.bound === null && item.computer_id === computer)}>{busy ? "Connecting…" : "Connect session"}</Button>
    </form>}
    {failure && <p role="alert">{failure}</p>}
  </div>;
}
