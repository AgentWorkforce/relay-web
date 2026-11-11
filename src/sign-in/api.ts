import { z } from "zod";
import { appPath } from "../app-path";

/**
 * Self-hosted password sign-in, against relaycontrol's public login config and
 * `/cloud/api/v1/auth/password/*` routes. The pages an emailed link opens
 * (`/login/password/verify`, `/login/password/reset`) are relaycontrol's own,
 * so link tokens never reach this app.
 */

const AUTH_BASE = "/cloud/api/v1/auth";

const loginConfigSchema = z.object({
  methods: z.array(z.string()),
  oidc: z.object({ displayName: z.string() }).nullable(),
  // Optional: an older relaycontrol does not send it.
  microsoft: z.object({ displayName: z.string() }).nullish(),
  logo_url: z.string().nullable(),
  // Optional: an older relaycontrol does not send it.
  org_name: z.string().nullish(),
  password_policy: z
    .object({ min_length: z.number(), max_length: z.number() })
    .nullable(),
});
export type LoginConfig = z.infer<typeof loginConfigSchema>;

export type SignInView = "sign-in" | "register" | "forgot-password";

const INVITE_TOKEN = /^sh_inv_[A-Za-z0-9_-]{20,200}$/;

/** A local path to return to; relaycontrol's `safeNextPath` rules. */
export function safeNext(value: string | null): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /\p{C}/u.test(value)
  )
    return appPath();
  return value;
}

/** `#/sign-in?next=…` and its sibling views, or null for any other route. */
export function signInRoute(hash: string) {
  const match = /^#\/(sign-in|register|forgot-password)(?:\?(.*))?$/.exec(hash);
  if (!match) return null;
  const params = new URLSearchParams(match[2] ?? "");
  const invite = params.get("invite");
  return {
    view: match[1] as SignInView,
    next: safeNext(params.get("next")),
    invite: invite && INVITE_TOKEN.test(invite) ? invite : null,
  };
}

/** Null when the server has no usable config (an older relaycontrol). */
export async function fetchLoginConfig(
  signal: AbortSignal,
): Promise<LoginConfig | null> {
  try {
    const response = await fetch(`${AUTH_BASE}/login-config`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    const parsed = loginConfigSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class SignInError extends Error {
  constructor(
    message: string,
    readonly code = "",
  ) {
    super(message);
  }
}

// One message for every failed sign-in: relaycontrol answers an unknown
// address, a wrong password and a locked account identically, so this copy
// explains a lockout without ever claiming one is in force.
export const INVALID_CREDENTIALS_MESSAGE =
  "Incorrect email or password. After repeated failed attempts, sign-in pauses for up to 15 minutes, even with the right password. Wait and try again, or reset your password.";
export const RATE_LIMITED_MESSAGE =
  "Too many attempts, or the server is busy. Wait a minute and try again.";

const MESSAGES: Record<string, string> = {
  invalid_credentials: INVALID_CREDENTIALS_MESSAGE,
  rate_limited: RATE_LIMITED_MESSAGE,
  email_invalid: "Enter a valid email address.",
  csrf_rejected: "This page could not verify the request. Reload and try again.",
  signin_method_disabled: "Password sign-in is not enabled on this installation.",
};

async function post(route: string, body: Record<string, string>): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${AUTH_BASE}/password/${route}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SignInError(
      "Could not reach the server. Check your connection and try again.",
    );
  }
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  const code = payload?.error ?? "";
  throw new SignInError(
    MESSAGES[code] ?? "That request failed. Try again.",
    code,
  );
}

export const signInApi = {
  login: (email: string, password: string) =>
    post("login", { email, password }),
  register: (email: string, invite: string | null) =>
    post("register", invite ? { email, invite } : { email }),
  requestReset: (email: string) => post("reset", { email }),
};
