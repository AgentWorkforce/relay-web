// Self-hosted connection editor, using relay-control's native OAuth/credential APIs.
import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { adminApi } from "../admin/api";
import type { IntegrationProvider } from "../admin/contracts";
import { message } from "../admin/use-load";
import { ProviderLogo } from "../shell/provider-logo";
import { Button } from "../shell/ui";
import {
  FlowConnections,
  connectionAuthLabel,
  type IntegrationListEntry,
} from "./flow-connections";
import s from "./flow-connection-manager.module.css";

export function FlowConnectionManager({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<IntegrationListEntry | "new" | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(operation: () => Promise<void>) {
    if (busy.current || !canManage) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (failure) {
      if (alive.current) setError(message(failure));
    } finally {
      if (alive.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  function saved() {
    if (!alive.current) return;
    setRevision((value) => value + 1);
    setEditing(null);
    setNotice("Connection updated.");
  }
  return (
    <>
      {error && !editing && (
        <p role="alert" className={s.notice}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={s.notice}>
          {notice}
        </p>
      )}
      <FlowConnections
        key={revision}
        workspaceId={workspaceId}
        canManage={canManage}
        disabled={pending}
        onBusyChange={(value) => {
          busy.current = value;
          setPending(value);
        }}
        actions={
          canManage && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                if (busy.current) return;
                setEditing("new");
                setError("");
              }}
            >
              <Plus data-icon="inline-start" />
              Add connection
            </Button>
          )
        }
        renderConnectionActions={(entry) => (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (busy.current) return;
              setEditing(entry);
              setError("");
            }}
          >
            <Pencil data-icon="inline-start" />
            Edit connection
          </Button>
        )}
      />
      {editing && (
        <ConnectionEditor
          key={editing === "new" ? "new" : editing.connectionId}
          workspaceId={workspaceId}
          entry={editing === "new" ? undefined : editing}
          pending={pending}
          error={error}
          onClearError={() => setError("")}
          onCancel={() => {
            if (!busy.current) setEditing(null);
          }}
          onRename={(entry, name) =>
            run(async () => {
              await adminApi.renameIntegration(
                workspaceId,
                entry.provider,
                entry.connectionId!,
                name,
                entry.version,
              );
              saved();
            })
          }
          onCreate={(provider, credentials) =>
            run(async () => {
              if (provider.authMode === "OAUTH2") {
                const session = await adminApi.connectIntegration(
                  workspaceId,
                  provider.id,
                  window.location.href,
                );
                const destination = new URL(
                  session.connectLink,
                  window.location.origin,
                );
                if (
                  destination.protocol !== "https:" &&
                  destination.origin !== window.location.origin
                )
                  throw new Error(
                    "The provider returned an invalid authorization URL.",
                  );
                if (alive.current)
                  window.location.assign(destination.toString());
              } else {
                await adminApi.createIntegrationWithCredentials(
                  workspaceId,
                  provider.id,
                  credentials,
                );
                saved();
              }
            })
          }
        />
      )}
    </>
  );
}

function ConnectionEditor({
  workspaceId,
  entry,
  pending,
  error,
  onCancel,
  onClearError,
  onRename,
  onCreate,
}: {
  workspaceId: string;
  entry?: IntegrationListEntry;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onClearError: () => void;
  onRename: (entry: IntegrationListEntry, name: string) => Promise<void>;
  onCreate: (
    provider: IntegrationProvider,
    credentials: Record<string, string>,
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [providers, setProviders] = useState<IntegrationProvider[] | null>(
    null,
  );
  const [catalogError, setCatalogError] = useState("");
  const [providerId, setProviderId] = useState("");
  const [name, setName] = useState(entry?.connectionLabel ?? entry?.name ?? "");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      opener?.focus();
    };
  }, []);
  useEffect(() => {
    if (entry) return;
    const controller = new AbortController();
    void adminApi
      .integrationProviders(workspaceId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setProviders(result.providers);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setCatalogError(message(failure));
      });
    return () => controller.abort();
  }, [entry, workspaceId]);
  const provider = providers?.find((item) => item.id === providerId);
  return (
    <dialog
      ref={dialog}
      className={s.editor}
      aria-labelledby="connection-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <header className={s.header}>
        <div>
          {(provider || entry) && (
            <ProviderLogo provider={entry?.provider ?? providerId} size={28} />
          )}
          <h2 id="connection-editor-title">
            {entry ? "Edit connection" : "Add a connection"}
          </h2>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={pending}
          onClick={onCancel}
          aria-label="Close"
        >
          <X />
        </Button>
      </header>
      <p className={s.hint}>
        {entry
          ? "Give this connection a recognizable name. Its account and permissions stay the same."
          : "Choose a tool and authorize access for your flows."}
      </p>
      <form
        className={s.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (entry) void onRename(entry, name.trim());
          else if (provider && !provider.connection)
            void onCreate(provider, credentials);
        }}
      >
        {(error || catalogError) && <p role="alert">{error || catalogError}</p>}
        {entry ? (
          <>
            <label>
              Connection name
              <input
                required
                maxLength={80}
                value={name}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div>
              <span className={s.hint}>Authentication</span>
              <p>{connectionAuthLabel(entry)}</p>
            </div>
            <div>
              <span className={s.hint}>Connected account</span>
              <p>{entry.accountLabel ?? "Not recorded"}</p>
            </div>
            <p className={s.hint}>
              Renaming does not change provider permissions or credentials. To
              change the account or authentication method, disconnect and
              connect again.
            </p>
          </>
        ) : (
          <>
            <label>
              Tool
              <select
                value={providerId}
                disabled={pending || !providers}
                required
                onChange={(event) => {
                  setProviderId(event.target.value);
                  onClearError();
                  setCredentials({});
                }}
              >
                <option value="">
                  {providers ? "Choose a tool" : "Loading tools…"}
                </option>
                {providers?.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={Boolean(item.connection)}
                  >
                    {item.displayName}
                    {item.connection ? " — Already connected" : ""}
                  </option>
                ))}
              </select>
            </label>
            {provider && (
              <p className={s.hint}>
                {provider.authMode === "OAUTH2"
                  ? "OAuth — continue to the provider to approve access."
                  : "Access token — stored encrypted and never displayed after saving."}
              </p>
            )}
            {provider && !provider.configured && (
              <p role="note">
                {provider.adminMessage ??
                  "Ask an administrator to configure this provider."}
              </p>
            )}
            {provider?.authMode === "API_KEY" &&
              provider.credentialFields?.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    value={credentials[field.key] ?? ""}
                    onChange={(event) =>
                      setCredentials((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    required={field.required}
                    placeholder={field.placeholder}
                    disabled={pending}
                  />
                </label>
              ))}
          </>
        )}
        <div className={s.actions}>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              pending ||
              (!entry &&
                (!provider?.configured ||
                  (provider.authMode === "API_KEY" &&
                    !provider.credentialFields?.length))) ||
              (Boolean(entry) && !name.trim())
            }
          >
            {pending
              ? "Working…"
              : entry
                ? "Save changes"
                : provider?.authMode === "API_KEY"
                  ? "Connect securely"
                  : "Continue to authorization"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
