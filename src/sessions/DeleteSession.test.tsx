import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  fireEvent.click(await screen.findByRole("button", { name: "Delete session" }));
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
  const fetch = stub("admin", Response.json({ status: "completed" }));
  const onDeleted = vi.fn();
  render(<DeleteSession workspaceId="w 1" source="codex" sessionId="s/1" onDeleted={onDeleted} />);
  await openConfirm();
  expect(fetch).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
  expect(url).toBe("/cloud/api/v1/organizations/org%2F1/sessions/s%2F1?workspaceId=w+1&source=codex");
  expect(init.method).toBe("DELETE");
  expect(init.credentials).toBe("same-origin");
});

it("cancel sends nothing", async () => {
  const fetch = stub("owner", Response.json({ status: "completed" }));
  render(<DeleteSession {...target} onDeleted={vi.fn()} />);
  await openConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Delete session" })).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not report an in-progress erase as deleted", async () => {
  stub("owner", Response.json({ status: "in_progress" }, { status: 202 }));
  const onDeleted = vi.fn();
  render(<DeleteSession {...target} onDeleted={onDeleted} />);
  await openConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
  expect((await screen.findByRole("status")).textContent).toMatch(/in progress/);
  expect(onDeleted).not.toHaveBeenCalled();
});

it("shows the server's reason when the erase is refused or unavailable", async () => {
  stub("owner", Response.json(
    { error: "not_implemented", message: "Session erasure is not configured for this installation" },
    { status: 501 },
  ));
  const onDeleted = vi.fn();
  render(<DeleteSession {...target} onDeleted={onDeleted} />);
  await openConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/not configured/);
  expect(onDeleted).not.toHaveBeenCalled();
});
