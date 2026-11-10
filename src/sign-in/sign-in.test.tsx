import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resetBrandingForTests } from "../shell/branding";
import { SignInPage } from "./SignInPage";
import {
  INVALID_CREDENTIALS_MESSAGE,
  RATE_LIMITED_MESSAGE,
  safeNext,
  signInRoute,
} from "./api";

type Answer = { status: number; body: unknown };
const INVITE = `sh_inv_${"a".repeat(24)}`;
const fullConfig = {
  methods: ["email_link", "password"],
  oidc: { displayName: "Okta" },
  logo_url: null,
  allowed_domain_hint: true,
  password_policy: { min_length: 12, max_length: 128 },
};

let config: Answer;
let answers: Record<string, Answer>;
let posts: Array<{ path: string; body: unknown; init: RequestInit }>;
const navigate = vi.fn();

beforeEach(() => {
  config = { status: 200, body: { ...fullConfig } };
  answers = {};
  posts = [];
  navigate.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      if (input === "/cloud/api/v1/auth/login-config")
        return new Response(JSON.stringify(config.body), { status: config.status });
      posts.push({ path: input, body: JSON.parse(init.body as string), init });
      const answer = answers[input] ?? { status: 202, body: { status: "ok" } };
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const show = (view: "sign-in" | "register" | "forgot-password", invite: string | null = null) =>
  render(<SignInPage view={view} next="/#/settings" invite={invite} navigate={navigate} />);

function fillSignIn(password = "correct horse battery") {
  fireEvent.change(screen.getAllByLabelText("Email address")[0]!, {
    target: { value: "a@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
}

it("parses only sign-in routes and refuses off-site next values", () => {
  expect(signInRoute("#/sessions")).toBeNull();
  expect(signInRoute("#/sign-in?next=%2F%23%2Fsettings")).toMatchObject({
    view: "sign-in",
    next: "/#/settings",
  });
  expect(signInRoute(`#/register?invite=${INVITE}`)?.invite).toBe(INVITE);
  expect(signInRoute("#/register?invite=nope")?.invite).toBeNull();
  for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "/a\nb", null])
    expect(safeNext(bad)).toBe("/");
});

it.each([
  ["no password method", { status: 200, body: { ...fullConfig, methods: ["email_link"], password_policy: null } }],
  ["an older server", { status: 404, body: {} }],
  ["a malformed config", { status: 200, body: { methods: "password" } }],
])("hands over to the server login page with %s", async (_label, answer) => {
  config = answer;
  show("sign-in");
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("/login?next=%2F%23%2Fsettings"),
  );
});

it("shows every configured method", async () => {
  show("sign-in");
  const oidc = await screen.findByRole("link", { name: "Continue with Okta" });
  expect(oidc.getAttribute("href")).toBe("/login/oidc/start?next=%2F%23%2Fsettings");
  expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Forgot password?" })).toBeTruthy();
});

it("hides methods the server does not offer", async () => {
  config = { status: 200, body: { ...fullConfig, methods: ["password"], oidc: null } };
  show("sign-in");
  await screen.findByRole("button", { name: "Sign in with password" });
  expect(screen.queryByRole("link", { name: /Continue with/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Email me a sign-in link" })).toBeNull();
});

it("posts the address and return path with the email-link form", async () => {
  show("sign-in", INVITE);
  const button = await screen.findByRole("button", { name: "Email me a sign-in link" });
  const form = button.closest("form")!;
  fireEvent.change(form.querySelector("input[type=email]")!, { target: { value: "a@example.test" } });
  expect(form.getAttribute("action")).toBe("/login/email");
  expect(Object.fromEntries(new FormData(form))).toEqual({
    email: "a@example.test",
    next: "/#/settings",
    invite: INVITE,
  });
});

it("sends an invited sign-in through the form route that redeems the invite", async () => {
  show("sign-in", INVITE);
  const button = await screen.findByRole("button", { name: "Sign in with password" });
  const form = button.closest("form")!;
  fireEvent.change(form.querySelector("input[type=email]")!, { target: { value: "a@example.test" } });
  fireEvent.change(form.querySelector("input[type=password]")!, { target: { value: "correct horse battery" } });
  expect(form.getAttribute("method")).toBe("post");
  expect(form.getAttribute("action")).toBe("/login/password");
  expect(Object.fromEntries(new FormData(form))).toEqual({
    email: "a@example.test",
    password: "correct horse battery",
    next: "/#/settings",
    invite: INVITE,
  });
});

it("co-brands under the Agent Relay lockup", async () => {
  config = {
    status: 200,
    body: { ...fullConfig, logo_url: "https://cdn.example.test/logo.svg", org_name: "Example Corp" },
  };
  const { container } = show("sign-in");
  expect(await screen.findByText("Example Corp")).toBeTruthy();
  const logo = container.querySelector('[data-slot="co-brand"] img')!;
  expect(logo.getAttribute("src")).toBe("https://cdn.example.test/logo.svg");
  expect(logo.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(container.querySelector("header hr")).toBeTruthy();
  expect(container.querySelector("header a svg")).toBeTruthy();
  // Stacked flush left with the mark, not indented under the wordmark.
  for (const el of [container.querySelector("header hr")!, container.querySelector('[data-slot="co-brand"]')!]) {
    expect(el.className).toContain("col-span-2");
    expect(el.className).not.toContain("col-start-2");
  }
});

it("starts the customer row under a profile logo instead of beside it", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {
    customerProfile: { productName: "Example Corp", logo: "/logo.svg" },
  } as never;
  resetBrandingForTests();
  config = {
    status: 200,
    body: { ...fullConfig, logo_url: "https://cdn.example.test/logo.svg", org_name: "Example Corp" },
  };
  const { container } = show("sign-in");
  await screen.findByText("Example Corp");
  expect(container.querySelector('[data-slot="co-brand"]')!.className).toContain("col-span-2");
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
  resetBrandingForTests();
});

it.each([
  ["no logo", { logo_url: null, org_name: "Example Corp" }],
  ["a non-https logo", { logo_url: "http://cdn.example.test/logo.svg", org_name: "Example Corp" }],
  ["a script URL", { logo_url: "javascript:alert(1)", org_name: "Example Corp" }],
])("shows only Agent Relay with %s", async (_label, fields) => {
  config = { status: 200, body: { ...fullConfig, ...fields } };
  const { container } = show("sign-in");
  await screen.findByRole("button", { name: "Sign in with password" });
  expect(container.querySelector("header a svg")).toBeTruthy();
  expect(container.querySelector("header hr")).toBeNull();
  expect(container.querySelector('[data-slot="co-brand"]')).toBeNull();
  expect(screen.queryByText("Example Corp")).toBeNull();
});

it("signs in and returns to next", async () => {
  answers["/cloud/api/v1/auth/password/login"] = { status: 200, body: { userId: "u" } };
  show("sign-in");
  await screen.findByLabelText("Password");
  fillSignIn();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/#/settings"));
  expect(posts[0]).toMatchObject({
    path: "/cloud/api/v1/auth/password/login",
    body: { email: "a@example.test", password: "correct horse battery" },
  });
  expect(posts[0]!.init.credentials).toBe("same-origin");
});

it("shows one message for every failed sign-in and clears the password", async () => {
  answers["/cloud/api/v1/auth/password/login"] = {
    status: 401,
    body: { error: "invalid_credentials", message: "Incorrect email or password." },
  };
  show("sign-in");
  await screen.findByLabelText("Password");
  fillSignIn();
  expect((await screen.findByRole("alert")).textContent).toBe(INVALID_CREDENTIALS_MESSAGE);
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  expect(navigate).not.toHaveBeenCalled();
});

it("explains rate limiting and keeps the password", async () => {
  answers["/cloud/api/v1/auth/password/login"] = {
    status: 429,
    body: { error: "rate_limited", message: "Too many sign-in attempts." },
  };
  show("sign-in");
  await screen.findByLabelText("Password");
  fillSignIn();
  expect((await screen.findByRole("alert")).textContent).toBe(RATE_LIMITED_MESSAGE);
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).not.toBe("");
});

it("registers with an invite, states the password rules and stays neutral", async () => {
  show("register", INVITE);
  expect(await screen.findByText(/of 12 to 128 characters/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a link" }));
  expect((await screen.findByRole("status")).textContent).toContain("If this address can join");
  expect(posts[0]).toMatchObject({
    path: "/cloud/api/v1/auth/password/register",
    body: { email: "a@example.test", invite: INVITE },
  });
});

it("requests a reset with a neutral confirmation", async () => {
  show("forgot-password");
  fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "a@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a reset link" }));
  expect((await screen.findByRole("status")).textContent).toContain("If that address has a password");
  expect(posts[0]).toMatchObject({
    path: "/cloud/api/v1/auth/password/reset",
    body: { email: "a@example.test" },
  });
});
