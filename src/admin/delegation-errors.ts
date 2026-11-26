import { ApiError, SignedOut } from "./api";
import { message } from "./use-load";

/** What a failed delegation request shows: relay-control's own text when it answered. */
export function delegationError(failure: unknown, fallback: string): string {
  if (failure instanceof ApiError) {
    // Delegation routes answer `{ error: <message>, code }`; others `{ error: <code>, message }`.
    const detail = (failure.body ?? {}) as { error?: unknown; message?: unknown };
    if (typeof detail.message === "string" && detail.message) return detail.message;
    if (typeof detail.error === "string" && detail.error) return detail.error;
    return fallback;
  }
  // An expired session goes to sign in; anything else never reached relay-control.
  if (failure instanceof SignedOut) return message(failure);
  return "Could not reach the server. Try again.";
}

/** The code of a failed delegation request: `{error: <message>, code}` today, `{error: <code>, message}` on the bindings routes. */
export function delegationCode(failure: unknown): string | null {
  if (!(failure instanceof ApiError)) return null;
  const detail = (failure.body ?? {}) as { error?: unknown; code?: unknown; message?: unknown };
  if (typeof detail.code === "string") return detail.code;
  return typeof detail.message === "string" && typeof detail.error === "string" ? detail.error : null;
}
