// Whether the `@name` agent filter is offered. Neither relaycontrol nor the
// read API publishes the session agent index's readiness, so the dashboard
// learns it from the list: the first `agent_filter_not_ready` refusal turns
// the filter off for that workspace (until a retry or reload), and `@name`
// is searched as plain text instead. Operators whose backend is known not to
// be ready can turn the filter off up front with the `sessionAgentFilter`
// runtime flag.
import { useCallback, useSyncExternalStore } from "react";
import { sessionAgentFilterEnabled } from "../app-path";

const notReady = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** False while the agent filter is known not to work for this workspace. */
export function agentFilterAvailable(workspace: string): boolean {
  return sessionAgentFilterEnabled() && !notReady.has(workspace);
}

/** Whether the agent filter was turned off by a refusal (so a retry can help). */
export function agentFilterRefused(workspace: string): boolean {
  return notReady.has(workspace);
}

/** Record an `agent_filter_not_ready` refusal. */
export function markAgentFilterNotReady(workspace: string): void {
  if (notReady.has(workspace)) return;
  notReady.add(workspace);
  notify();
}

/** Offer the agent filter again (the person asked to retry it). */
export function retryAgentFilter(workspace: string): void {
  if (!notReady.delete(workspace)) return;
  notify();
}

export function useAgentFilterAvailable(workspace: string): boolean {
  const snapshot = useCallback(() => agentFilterAvailable(workspace), [workspace]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Tests only: forget every refusal. */
export function resetAgentFilterReadiness(): void {
  notReady.clear();
  notify();
}
