import { useEffect, useId, useState, type FormEvent } from "react";
import { Badge, Button, Input } from "../shell/ui";
import { ApiError, desktopFeedApi } from "./api";
import type { InstallTokenSummary } from "./contracts";
import { CopyField } from "./copy-field";
import { message, useLoad } from "./use-load";
import s from "./install-tokens.module.css";

const LABEL_MAX = 128;
// The longest delay a browser timer honours.
const TIMER_MAX_MS = 2_147_483_647;

const STATUS: Record<InstallTokenSummary["status"], { text: string; variant: "success" | "default" }> = {
  active: { text: "Active", variant: "success" },
  expired: { text: "Expired", variant: "default" },
  revoked: { text: "Revoked", variant: "default" },
};

function formatTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function failureText(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Too many install tokens were created in the last hour. Try again later.";
  }
  return message(error);
}

// The list is loaded once, so a token the server called active can pass its
// expiry while the page stays open.
function expiresAt(token: InstallTokenSummary): number | null {
  const at = Date.parse(token.expires_at);
  return token.status === "active" && Number.isFinite(at) ? at : null;
}

function statusAt(token: InstallTokenSummary, now: number): InstallTokenSummary["status"] {
  const at = expiresAt(token);
  return at !== null && at <= now ? "expired" : token.status;
}

function newestFirst(tokens: readonly InstallTokenSummary[]): InstallTokenSummary[] {
  return [...tokens].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/**
 * Install tokens for one release-feed profile: a first headless install
 * needs one. The secret is held in this component's state only, shown once,
 * and dropped on "Done", on unmount and when the profile changes.
 */
export function InstallTokens(props: { profileId: string }) {
  const profile = props.profileId;
  // `tokens: null` means the feed answered 404: no section at all.
  const { data, error, reload } = useLoad(async (signal) => ({
    tokens: await desktopFeedApi.installTokens(profile, signal),
  }));
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<{ profile: string; token: string; expiresAt: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  // Revoked rows, shown at once while the list reloads.
  const [revoked, setRevoked] = useState<Record<string, InstallTokenSummary>>({});
  const [now, setNow] = useState(() => Date.now());
  const titleId = useId();
  const labelId = useId();

  const nextExpiry = (data?.tokens ?? []).reduce<number | null>((next, token) => {
    const at = expiresAt(token);
    return at !== null && at > now && (next === null || at < next) ? at : next;
  }, null);
  useEffect(() => {
    if (nextExpiry === null) return;
    const delay = Math.min(Math.max(nextExpiry - Date.now(), 0), TIMER_MAX_MS);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [nextExpiry, now]);
  // Timers are held back in a background tab, so check again on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (!error && (!data || data.tokens === null)) return null;

  const shown = created && created.profile === profile ? created : null;
  const tokens = data?.tokens ? newestFirst(data.tokens.map((token) => revoked[token.id] ?? token)) : null;

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    setCreated(null);
    try {
      const token = await desktopFeedApi.createInstallToken(profile, label.trim() || undefined);
      setCreated({ profile, token: token.token, expiresAt: token.expires_at });
      setLabel("");
      reload();
    } catch (failed) {
      setFailure(failureText(failed));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    setFailure(null);
    try {
      const summary = await desktopFeedApi.revokeInstallToken(profile, id);
      setRevoked((current) => ({ ...current, [id]: summary }));
      reload();
    } catch (failed) {
      if (failed instanceof ApiError && failed.status === 404 && failed.code === "install_token_not_found") {
        reload();
      } else {
        setFailure(failureText(failed));
      }
    } finally {
      setRevoking(null);
    }
  }

  return (
    <section className={s.section} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.title}>
        Install token
      </h2>
      <p className={s.text}>
        A first install on a machine without a desktop needs an install token. It can only read
        this workspace&rsquo;s release feed and lasts 1 hour. Later runs of the install script use
        the installed client&rsquo;s own sign-in.
      </p>
      <form className={s.form} onSubmit={(event) => void create(event)}>
        <label htmlFor={labelId} className={s.label}>
          Label (optional)
        </label>
        <div className={s.formRow}>
          <Input
            id={labelId}
            className={s.input}
            value={label}
            maxLength={LABEL_MAX}
            autoComplete="off"
            placeholder="build-server-1"
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Creating…" : "Create install token"}
          </Button>
        </div>
      </form>
      {failure && (
        <p role="alert" className={s.failure}>
          {failure}
        </p>
      )}
      {shown && (
        <div className={s.created}>
          <p role="status" className={s.createdTitle}>
            Install token created. Copy it now: it will not be shown again.
          </p>
          <CopyField value={shown.token} label="install token" />
          <p className={s.text}>Expires {formatTime(shown.expiresAt)}.</p>
          <p className={s.text}>
            Set it as <code>AGENT_RELAY_INSTALL_TOKEN</code> in the shell that runs the install
            script, then run the script in that same shell. To keep the token out of your shell
            history, paste it at a prompt instead of into a command:
          </p>
          <dl className={s.usage}>
            <dt>macOS and Linux (.sh scripts)</dt>
            <dd>
              <CopyField
                value="read -rs AGENT_RELAY_INSTALL_TOKEN && export AGENT_RELAY_INSTALL_TOKEN"
                label="command for macOS and Linux"
              />
            </dd>
            <dt>Windows PowerShell (.ps1 script)</dt>
            <dd>
              <CopyField
                value="$env:AGENT_RELAY_INSTALL_TOKEN = Read-Host"
                label="command for Windows PowerShell"
              />
            </dd>
          </dl>
          <p className={s.text}>
            After running the command, paste the token and press Enter. On macOS and Linux nothing
            is shown while you paste.
          </p>
          <Button variant="outline" size="sm" onClick={() => setCreated(null)}>
            Done
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className={s.failure}>
          {message(error)}{" "}
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      )}
      {tokens && tokens.length === 0 && <p className={s.quiet}>No install tokens yet.</p>}
      {tokens && tokens.length > 0 && (
        <ul className={s.rows} aria-label="Your install tokens">
          {tokens.map((token) => {
            const current = statusAt(token, now);
            const status = STATUS[current];
            const name = token.label ?? "No label";
            return (
              <li key={token.id} className={s.row}>
                <div className={s.rowMain}>
                  <p className={s.rowTitle}>
                    {name}
                    <code className={s.prefix}>{token.token_prefix}…</code>
                    <Badge variant={status.variant} className={s.badge}>
                      {status.text}
                    </Badge>
                  </p>
                  <p className={s.rowMeta}>
                    Created {formatTime(token.created_at)} · Expires {formatTime(token.expires_at)}
                    {token.last_used_at && ` · Last used ${formatTime(token.last_used_at)}`}
                  </p>
                </div>
                {current === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoking === token.id}
                    aria-label={`Revoke install token ${token.token_prefix}…${token.label ? ` (${token.label})` : ""}`}
                    onClick={() => void revoke(token.id)}
                  >
                    {revoking === token.id ? "Revoking…" : "Revoke"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
