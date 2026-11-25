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
