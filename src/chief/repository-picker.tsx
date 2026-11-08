import { useEffect, useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { adminApi } from "../admin/api";
import { Button, Input } from "../shell/ui";
import { chiefApi, type GithubRepository, type RepositoryCatalog } from "./api";
import s from "./chief.module.css";

export function RepositoryPicker({
  workspace,
  disabled,
  selected,
  onChange,
  onReady,
}: {
  workspace: string;
  disabled: boolean;
  selected: GithubRepository[];
  onChange(repositories: GithubRepository[]): void;
  onReady(ready: boolean): void;
}) {
  const [catalog, setCatalog] = useState<RepositoryCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const loading = loadedVersion !== version;
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectLink, setConnectLink] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    onReady(false);
    chiefApi
      .repositories(workspace, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        setError(null);
        setCatalog(result);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("Could not load GitHub repositories. Refresh to try again.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadedVersion(version);
      });
    return () => abort.abort();
  }, [workspace, version, onReady]);
  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const available = catalog?.repositories ?? [];
  const visible = available.filter((repo) =>
    repo.fullName.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const inaccessible = selected.some(
    (repo) => !available.some((item) => item.id === repo.id),
  );
  useEffect(() => {
    onReady(!loading && !error && !!catalog?.connected && !inaccessible);
  }, [loading, error, catalog, inaccessible, onReady]);
  async function connect() {
    // Open during the click so browsers permit the authorization window.
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setConnecting(true);
    setError(null);
    try {
      const session = await adminApi.connectIntegration(
        workspace,
        "github",
        window.location.href,
      );
      const url = new URL(session.connectLink, window.location.origin);
      if (url.protocol !== "https:" && url.origin !== window.location.origin)
        throw new Error("invalid_connect_url");
      setConnectLink(url.href);
      if (popup) popup.location.href = url.href;
    } catch {
      popup?.close();
      setError(
        "Could not start GitHub authorization. Check the workspace integration settings, then try again.",
      );
    } finally {
      setConnecting(false);
    }
  }
  return (
    <section className={s.picker} aria-label="GitHub repositories">
      <div className={s.pickerHeader}>
        <div>
          <strong>
            <GitBranch size={16} /> GitHub repositories
          </strong>
          <small>
            {catalog?.connected
              ? "Choose one or more repositories available to your workspace."
              : "Connect GitHub to choose repositories for your chief."}
          </small>
        </div>
        <Button
          variant="ghost"
          disabled={disabled || connecting}
          onClick={() => void connect()}
        >
          {connecting
            ? "Connecting…"
            : catalog?.connected
              ? "Manage access"
              : "Connect GitHub"}
        </Button>
      </div>
      {connectLink && (
        <p className={s.muted}>
          Complete authorization in the new window, then refresh.{" "}
          <a href={connectLink} target="_blank" rel="noopener noreferrer">
            Open GitHub connection
          </a>
        </p>
      )}
      {catalog?.connected && (
        <>
          <label>
            Search repositories
            <Input
              value={query}
              placeholder="Search by organization or repository"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className={s.repositoryOptions} aria-busy={loading}>
            {visible.map((repo) => (
              <label className={s.repoOption} key={repo.id}>
                <input
                  type="checkbox"
                  aria-label={repo.fullName}
                  checked={selected.some((item) => item.id === repo.id)}
                  disabled={
                    disabled ||
                    loading ||
                    (!selected.some((item) => item.id === repo.id) &&
                      selected.length >= 100)
                  }
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, repo]
                        : selected.filter((item) => item.id !== repo.id),
                    )
                  }
                />
                <span>{repo.fullName}</span>
                <small>{repo.private ? "Private" : "Public"}</small>
              </label>
            ))}
            {!loading && !visible.length && (
              <p className={s.muted}>
                {available.length
                  ? "No repositories match your search."
                  : "No repositories available. Grant repository access in your GitHub App installation, then refresh."}
              </p>
            )}
          </div>
          <p className={s.selectionCount} aria-live="polite">
            {selected.length} selected
            {selected.length > 0 &&
              ` · ${selected.map((repo) => repo.fullName).join(", ")}`}
          </p>
        </>
      )}
      {loading && (
        <p className={s.muted} role="status">
          <Loader2 size={15} className={s.spin} /> Loading repositories…
        </p>
      )}
      {inaccessible && !loading && !error && (
        <p role="alert" className={s.error}>
          Repository access changed. Clear the selection and choose available
          repositories.{" "}
          <Button variant="ghost" onClick={() => onChange([])}>
            Clear selection
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <Button
        variant="ghost"
        disabled={loading}
        onClick={() => setVersion((v) => v + 1)}
      >
        Refresh repositories
      </Button>
    </section>
  );
}
