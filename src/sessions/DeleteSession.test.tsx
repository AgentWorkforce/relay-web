import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeleteSession } from "./DeleteSession";

const target = { workspaceId: "w1", source: "codex", sessionId: "s1" };

const context = (role: string) => ({
  user: { id: "u1", email: "me@acme.test", name: "Me" },
  currentOrganization: { id: "org/1", name: "Acme", role },
  currentWorkspace: { id: "w1", name: "primary" },
});

function stub(role: string, reply: Response) {
  const fetch = vi.fn(async (url: string) =>
    url.endsWith("/auth/whoami") ? Response.json(context(role)) : reply,
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

const openConfirm = async () => {
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete session" }),
  );
  return screen.getByRole("alertdialog");
};

it("is not offered to members", async () => {
  const fetch = stub("member", Response.json({}));
  render(<DeleteSession {...target} onDeleted={vi.fn()} />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await Promise.resolve();
  expect(screen.queryByRole("button", { name: "Delete session" })).toBeNull();
});

it("deletes only after confirmation, then leaves the session", async () => {
  const fetch = stub(
    "admin",
    Response.json({ status: "completed", unreadable: true }),
  );
  const onDeleted = vi.fn();
  render(
    <DeleteSession
      workspaceId="w 1"
      source="codex"
      sessionId="s/1"
      onDeleted={onDeleted}
    />,
  );
  await openConfirm();
  expect(fetch).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
  expect(url).toBe(
    "/cloud/api/v1/organizations/org%2F1/sessions/s%2F1?workspaceId=w+1&source=codex",
  );
  expect(init.method).toBe("DELETE");
  expect(init.credentials).toBe("same-origin");
});

it("cancel sends nothing and focus follows the confirmation", async () => {
  const fetch = stub(
    "owner",
    Response.json({ status: "completed", unreadable: true }),
  );
  render(<DeleteSession {...target} onDeleted={vi.fn()} />);
  await openConfirm();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Cancel" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Delete session" }),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("opens a modal above an inert background and traps focus away from the destructive action by default", async () => {
  const fetch = stub(
    "owner",
    Response.json({ status: "completed", unreadable: true }),
  );
  const { container } = render(
    <>
      <button>Outside</button>
      <DeleteSession {...target} onDeleted={vi.fn()} />
    </>,
  );
  const outside = screen.getByRole("button", { name: "Outside" });
  const modal = await openConfirm();
  const cancel = within(modal).getByRole("button", { name: "Cancel" });
  const confirm = within(modal).getByRole("button", {
    name: "Yes, delete session",
  });
  expect(modal.getAttribute("aria-modal")).toBe("true");
  expect(container.contains(modal)).toBe(false);
  expect(container.hasAttribute("inert")).toBe(true);
  expect(container.getAttribute("aria-hidden")).toBe("true");
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(confirm);
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(cancel);
  outside.focus();
  expect(document.activeElement).toBe(cancel);
  fireEvent.click(cancel);
  expect(container.hasAttribute("inert")).toBe(false);
  expect(container.hasAttribute("aria-hidden")).toBe(false);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("Escape closes without deleting and restores focus, including on a second opening", async () => {
  const fetch = stub("owner", Response.json({}));
  render(<DeleteSession {...target} onDeleted={vi.fn()} />);
  for (let attempt = 0; attempt < 2; attempt++) {
    await openConfirm();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete session" }),
    );
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps pending state in the modal and sends only one DELETE across repeated clicks and reopening", async () => {
  let finish: (response: Response) => void = () => undefined;
  const fetch = vi.fn((url: string) =>
    url.endsWith("/auth/whoami")
      ? Promise.resolve(Response.json(context("owner")))
      : new Promise<Response>((resolve) => {
          finish = resolve;
        }),
  );
  vi.stubGlobal("fetch", fetch);
  const onDeleted = vi.fn();
  render(<DeleteSession {...target} onDeleted={onDeleted} />);
  let modal = await openConfirm();
  const confirm = within(modal).getByRole("button", {
    name: "Yes, delete session",
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(within(modal).getByRole("status").textContent).toBe(
    "Deletion is in progress.",
  );
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  modal = await openConfirm();
  fireEvent.click(
    within(modal).getByRole("button", { name: "Yes, delete session" }),
  );
  expect(fetch).toHaveBeenCalledTimes(2); // whoami plus exactly one DELETE
  fireEvent.click(within(modal).getByRole("button", { name: "Cancel" }));
  finish(Response.json({ status: "completed", unreadable: true }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("reports a failed erase and leaves a retry", async () => {
  stub("owner", Response.json({ status: "failed", unreadable: false }));
  const onDeleted = vi.fn();
  render(<DeleteSession {...target} onDeleted={onDeleted} />);
  await openConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /could not be fully erased/,
  );
  expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toBe(
    screen.getByRole("alert"),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(onDeleted).not.toHaveBeenCalled();
  expect(
    (
      screen.getByRole("button", {
        name: "Yes, delete session",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

it("does not navigate after the page has been left", async () => {
  let finish: (response: Response) => void = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.endsWith("/auth/whoami")
        ? Promise.resolve(Response.json(context("owner")))
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    ),
  );
  const onDeleted = vi.fn();
  const { unmount } = render(
    <DeleteSession {...target} onDeleted={onDeleted} />,
  );
  await openConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
  unmount();
  finish(Response.json({ status: "completed", unreadable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onDeleted).not.toHaveBeenCalled();
});

it("does not report an in-progress erase as deleted", async () => {
  stub(
    "owner",
    Response.json({ status: "in_progress", unreadable: true }, { status: 202 }),
  );
  const onDeleted = vi.fn();
  render(<DeleteSession {...target} onDeleted={onDeleted} />);
  await openConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toMatch(
      /hidden from everyone.*still being erased/,
    ),
  );
  expect(within(screen.getByRole("alertdialog")).getByRole("status")).toBe(
    screen.getByRole("status"),
  );
  expect(onDeleted).not.toHaveBeenCalled();
});

it("shows the server's reason when the erase is refused or unavailable", async () => {
  stub(
    "owner",
    Response.json(
      {
        error: "not_implemented",
        message: "Session erasure is not configured for this installation",
      },
      { status: 501 },
    ),
  );
  const onDeleted = vi.fn();
  render(<DeleteSession {...target} onDeleted={onDeleted} />);
  await openConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /not configured/,
  );
  expect(onDeleted).not.toHaveBeenCalled();
});
