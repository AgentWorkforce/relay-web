// The Session intelligence view's data: one load per workspace (which decides
// whether the tab is shown), then a bounded refresh while the view is open.
// At most one request is in flight; a workspace change or unmount aborts it.
// A failed refresh keeps the last good view and reports the failure.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  sessionIntelWorkspace,
  type SessionIntelResponse,
} from "./session-intel-api";

export const SESSION_INTEL_REFRESH_MS = 60_000;

type Loader = (
  workspace: string,
  signal: AbortSignal,
) => Promise<SessionIntelResponse | null>;

type State = {
  workspaceId: string;
  /** undefined: loading; null: the view isn't served here. */
  data: SessionIntelResponse | null | undefined;
  /** A failure before any good view. */
  error: Error | null;
  /** A failure after a good view; the good view is kept. */
  refreshError: Error | null;
  updatedAt: number | null;
  refreshing: boolean;
};

export type SessionIntelLoad = Omit<State, "workspaceId"> & {
  loading: boolean;
  refresh: () => void;
};

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

export function useSessionIntel(
  workspaceId: string,
  /** The view is open: refresh it every minute while the page is visible. */
  active: boolean,
  load: Loader = sessionIntelWorkspace,
): SessionIntelLoad {
  const [state, setState] = useState<State | null>(null);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  const inFlight = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0);

  const run = useCallback(() => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    lastAttempt.current = Date.now();
    const settle = (update: (good: State | null) => State) => {
      if (controller.signal.aborted) return;
      inFlight.current = null;
      setState((current) => {
        const good =
          current?.workspaceId === workspaceId && current.data ? current : null;
        return update(good);
      });
    };
    const first = (data: State["data"], error: Error | null): State => ({
      workspaceId,
      data,
      error,
      refreshError: null,
      updatedAt: data ? Date.now() : null,
      refreshing: false,
    });
    loader.current(workspaceId, controller.signal).then(
      (data) =>
        settle((good) =>
          !good
            ? first(data, null)
            : data
              ? { ...good, data, refreshError: null, updatedAt: Date.now(), refreshing: false }
              : // Whether the tab is shown comes from the first load only.
                { ...good, refreshing: false, refreshError: new Error("The view is no longer served.") },
        ),
      (error: unknown) =>
        settle((good) =>
          good
            ? { ...good, refreshing: false, refreshError: asError(error) }
            : first(undefined, asError(error)),
        ),
    );
  }, [workspaceId]);

  useEffect(() => {
    run();
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [run]);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    setState((current) =>
      current?.workspaceId === workspaceId && current.data
        ? { ...current, refreshing: true }
        : current,
    );
    run();
  }, [run, workspaceId]);

  useEffect(() => {
    if (!active) return;
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => {
      if (visible()) refresh();
    }, SESSION_INTEL_REFRESH_MS);
    const onVisibility = () => {
      if (visible() && Date.now() - lastAttempt.current >= SESSION_INTEL_REFRESH_MS)
        refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, refresh]);

  const current = state?.workspaceId === workspaceId ? state : null;
  return {
    data: current?.data,
    error: current?.error ?? null,
    refreshError: current?.refreshError ?? null,
    updatedAt: current?.updatedAt ?? null,
    refreshing: current?.refreshing ?? false,
    loading: !current,
    refresh,
  };
}
