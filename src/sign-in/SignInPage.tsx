import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { appPath, redirectBrowser, serverLoginHref } from "../app-path";
import { primaryAction, secondaryAction } from "../device/DevicePage";
import { BrandLockup } from "../shell/brand";
import { branding } from "../shell/branding";
import {
  fetchLoginConfig,
  signInApi,
  SignInError,
  type LoginConfig,
  type SignInView,
} from "./api";

const inputClass =
  "mt-2 w-full rounded-md border border-[#30485e] bg-[#101c29] px-4 py-2.5 text-sm text-[#e8f0f7] outline-none transition-colors placeholder:text-[#8298aa] focus:border-[#80bfe5] focus-visible:ring-2 focus-visible:ring-[#80bfe5]/30";
const labelClass = "block text-sm font-medium text-[#a9bdce]";
const linkClass =
  "text-[#80bfe5] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#80bfe5]";
const mutedClass = "text-sm leading-6 text-[#a9bdce]";

const HEADINGS: Record<SignInView, string> = {
  "sign-in": "Sign in",
  register: "Create your password",
  "forgot-password": "Reset your password",
};

type Target = { next: string; invite: string | null };

function viewHref(view: SignInView, { next, invite }: Target): string {
  const query = new URLSearchParams({ next });
  if (invite) query.set("invite", invite);
  return `#/${view}?${query}`;
}

function errorMessage(failure: unknown): string {
  return failure instanceof SignInError
    ? failure.message
    : "That request failed. Try again.";
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="text-sm leading-6 text-[#f3a5ad]">
      {text}
    </p>
  );
}

function EmailField(props: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <div>
      <label htmlFor={props.id} className={labelClass}>
        Email address
      </label>
      <input
        id={props.id}
        type="email"
        required
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        autoComplete={props.autoComplete}
        spellCheck={false}
        placeholder="you@company.com"
        className={inputClass}
      />
    </div>
  );
}

function PasswordForm(props: {
  target: Target;
  navigate: (url: string) => void;
  primary: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInApi.login(email, password);
      props.navigate(props.target.next);
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof SignInError && failure.code === "invalid_credentials")
        setPassword("");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <EmailField
        id="sign-in-email"
        value={email}
        onChange={setEmail}
        autoComplete="username"
      />
      <div>
        <label htmlFor="sign-in-password" className={labelClass}>
          Password
        </label>
        <input
          id="sign-in-password"
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className={inputClass}
        />
      </div>
      {error && <ErrorLine text={error} />}
      <button
        type="submit"
        disabled={busy}
        className={`${props.primary ? primaryAction : secondaryAction} w-full`}
      >
        {busy ? "Signing in…" : "Sign in with password"}
      </button>
      <p className={`${mutedClass} flex flex-wrap justify-between gap-x-4`}>
        <a href={viewHref("forgot-password", props.target)} className={linkClass}>
          Forgot password?
        </a>
        <a href={viewHref("register", props.target)} className={linkClass}>
          Create a password
        </a>
      </p>
    </form>
  );
}

/** A native POST: relaycontrol renders the "check your email" page itself. */
function EmailLinkForm({ target }: { target: Target }) {
  const [email, setEmail] = useState("");
  return (
    <form method="post" action="/login/email" className="space-y-4">
      <input type="hidden" name="next" value={target.next} />
      {target.invite && (
        <input type="hidden" name="invite" value={target.invite} />
      )}
      <EmailField
        id="email-link-email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />
      <button type="submit" className={`${secondaryAction} w-full`}>
        Email me a sign-in link
      </button>
    </form>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-[#a9bdce]">
      <span className="flex-1 border-t border-[#30485e]" />
      or
      <span className="flex-1 border-t border-[#30485e]" />
    </div>
  );
}

function SignInMethods(props: {
  config: LoginConfig;
  target: Target;
  navigate: (url: string) => void;
}) {
  const { config, target } = props;
  const emailLink = config.methods.includes("email_link");
  const oidcHref = `/login/oidc/start?${new URLSearchParams({ next: target.next })}`;
  return (
    <>
      {config.oidc && (
        <>
          <a href={oidcHref} className={`${primaryAction} w-full`}>
            Continue with {config.oidc.displayName}
          </a>
          <Divider />
        </>
      )}
      <PasswordForm
        target={target}
        navigate={props.navigate}
        primary={!config.oidc}
      />
      {emailLink && (
        <>
          <Divider />
          <EmailLinkForm target={target} />
        </>
      )}
    </>
  );
}

/** Register and reset share a shape: one address, then the same neutral answer. */
function RequestLinkForm(props: {
  submitLabel: string;
  sentText: string;
  children?: ReactNode;
  send: (email: string) => Promise<void>;
  backHref: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.send(email);
      setSent(true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm leading-6 text-[#e8f0f7]">
          {props.sentText}
        </p>
        <a href={props.backHref} className={linkClass}>
          Back to sign in
        </a>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-4">
      {props.children}
      <EmailField
        id="request-link-email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />
      {error && <ErrorLine text={error} />}
      <button
        type="submit"
        disabled={busy}
        className={`${primaryAction} w-full`}
      >
        {busy ? "Sending…" : props.submitLabel}
      </button>
      <p className={mutedClass}>
        <a href={props.backHref} className={linkClass}>
          Back to sign in
        </a>
      </p>
    </form>
  );
}

/**
 * Self-hosted sign-in when the install offers passwords. Any other install
 * (or a server without the login config) goes straight to relaycontrol's
 * `/login`, which stays the page for every other method and operator sign-in.
 */
export function SignInPage(props: {
  view: SignInView;
  next: string;
  invite: string | null;
  /** Leaves this page; replaceable in tests. */
  navigate?: (url: string) => void;
}) {
  const { view, next, invite, navigate = redirectBrowser } = props;
  const brand = branding();
  const [config, setConfig] = useState<LoginConfig | null>(null);

  useEffect(() => {
    const attempt = new AbortController();
    void fetchLoginConfig(attempt.signal).then((loaded) => {
      if (attempt.signal.aborted) return;
      if (loaded?.methods.includes("password")) setConfig(loaded);
      else navigate(serverLoginHref(next));
    });
    return () => attempt.abort();
  }, [navigate, next]);

  const target = { next, invite };
  const backHref = viewHref("sign-in", target);
  const policy = config?.password_policy;
  const logoUrl =
    !brand.logo && config?.logo_url?.startsWith("https://")
      ? config.logo_url
      : null;

  return (
    <div className="min-h-dvh bg-[#101c29] text-[#e8f0f7]">
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12 sm:py-16">
        <a
          href={appPath()}
          aria-label={`${brand.productName} home`}
          className="mb-8 flex w-fit shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#79b8de]"
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-6 w-auto max-w-[200px] object-contain object-left"
            />
          ) : (
            <BrandLockup
              brand={brand}
              markClassName="h-6"
              wordmarkClassName="h-5 [--fg:#e8f0f7]"
              logoClassName="h-6 w-auto max-w-[200px] object-contain object-left"
              variant="dark"
            />
          )}
        </a>
        <h1 className="mb-6 text-3xl font-semibold tracking-tight">
          {HEADINGS[view]}
        </h1>
        <section className="rounded-xl border border-[#30485e] bg-[#182838] p-6 sm:p-8">
          {!config && (
            <p role="status" className={mutedClass}>
              Loading…
            </p>
          )}
          {config && view === "sign-in" && (
            <SignInMethods config={config} target={target} navigate={navigate} />
          )}
          {config && view === "register" && (
            <RequestLinkForm
              key="register"
              submitLabel="Email me a link"
              sentText="If this address can join, we've sent it a link to set your password. The link works once and expires in 1 hour."
              send={(email) => signInApi.register(email, invite)}
              backHref={backHref}
            >
              <p className={mutedClass}>
                We'll email you a link to confirm your address, then you'll
                choose a password
                {policy
                  ? ` of ${policy.min_length} to ${policy.max_length} characters`
                  : ""}
                .
              </p>
            </RequestLinkForm>
          )}
          {config && view === "forgot-password" && (
            <RequestLinkForm
              key="forgot-password"
              submitLabel="Email me a reset link"
              sentText="If that address has a password here, we've sent it a reset link. The link works once and expires in 30 minutes. Changing your password signs you out everywhere."
              send={signInApi.requestReset}
              backHref={backHref}
            />
          )}
        </section>
        {config && view === "sign-in" && (
          <p className={`${mutedClass} mt-6`}>
            <a href={serverLoginHref(next)} className={linkClass}>
              Other sign-in options
            </a>
          </p>
        )}
      </main>
    </div>
  );
}
