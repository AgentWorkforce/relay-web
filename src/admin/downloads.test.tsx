import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DownloadsPage, isDownloadsPath } from "./downloads";

const FEED = "/cloud/api/v1/desktop/feed";
const sha = "ab".repeat(32);

function asset(id: string, name: string, kind: string, extra: Record<string, unknown> = {}) {
  return { id, name, platform: "Linux", arch: "x64", kind, size: 64 * 1024 * 1024, sha256: sha, ...extra };
}

function envelope(version: string, channel: string, assets: unknown[]) {
  return {
    manifest: {
      schema: 1, profile: "x7k2q", channel, version, published_at: "2026-11-08T10:00:00Z", notes: "", download_hosts: [], assets,
    },
    signature: "s".repeat(86),
    key_id: "fk_x7k2q_k1",
  };
}

type Reply = { status: number; body: unknown };
type Seen = { path: string; method: string; headers: Record<string, string> };

let replies: Record<string, Reply>;
let seen: Seen[];

beforeEach(() => {
  seen = [];
  replies = {
    "/cloud/api/v1/desktop/profiles": { status: 200, body: { profiles: [{ id: "x7k2q", asset_prefix: "Desktop" }] } },
    [`${FEED}/manifest?channel=stable`]: {
      status: 200,
      body: envelope("2026.11.9", "stable", [
        asset("a_deb00001", "Desktop-2026.11.9-Linux-x64.deb", "deb"),
        asset("a_probe001", "Desktop-2026.11.9-Linux-x64-probe.tar.gz", "probe"),
      ]),
    },
    [`${FEED}/manifest?channel=beta`]: { status: 404, body: { error: "no_release", message: "No release" } },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      seen.push({ path: input, method: init.method ?? "GET", headers: init.headers as Record<string, string> });
      const reply = replies[input] ?? { status: 500, body: { error: "unexpected" } };
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("lists the workspace's installers with version, size and sha256, without probes", async () => {
  render(<DownloadsPage navigate={() => undefined} />);
  expect(await screen.findByRole("heading", { name: "Version 2026.11.9" })).toBeInTheDocument();
  expect(screen.getByText("Desktop-2026.11.9-Linux-x64.deb")).toBeInTheDocument();
  expect(screen.getByText("64.0 MB")).toBeInTheDocument();
  expect(screen.getByText(sha)).toBeInTheDocument();
  expect(screen.queryByText("Desktop-2026.11.9-Linux-x64-probe.tar.gz")).toBeNull();
  expect(screen.getByRole("main")).toHaveClass("settings");
  const manifest = seen.find((call) => call.path.endsWith("channel=stable"));
  expect(manifest?.headers["X-Agent-Relay-Profile"]).toBe("x7k2q");
});

it("asks for a signed URL and then goes to it", async () => {
  const url = "https://feed-bucket.s3.eu-west-2.amazonaws.com/a?X-Amz-Expires=300";
  replies[`${FEED}/assets/a_deb00001/download-url`] = {
    status: 200,
    body: { url, expires_at: "2026-11-08T10:05:00.000Z" },
  };
  const navigate = vi.fn();
  render(<DownloadsPage navigate={navigate} />);
  fireEvent.click(await screen.findByRole("button", { name: "Download Desktop-2026.11.9-Linux-x64.deb" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(url));
  const call = seen.find((entry) => entry.path.endsWith("/download-url"));
  expect(call?.method).toBe("POST");
  expect(call?.headers["X-Agent-Relay-Profile"]).toBe("x7k2q");
});

it("refuses a download link that is not https", async () => {
  replies[`${FEED}/assets/a_deb00001/download-url`] = {
    status: 200,
    body: { url: "http://feed.example.test/a", expires_at: "2026-11-08T10:05:00.000Z" },
  };
  const navigate = vi.fn();
  render(<DownloadsPage navigate={navigate} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Download / }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not secure");
  expect(navigate).not.toHaveBeenCalled();
});

it("says so when the site only streams", async () => {
  replies[`${FEED}/assets/a_deb00001/download-url`] = { status: 501, body: { error: "no_object_storage", message: "x" } };
  render(<DownloadsPage navigate={() => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Download / }));
  expect(await screen.findByRole("alert")).toHaveTextContent("does not offer direct downloads");
});

it("shows an empty state without an entitlement or when the feed is off", async () => {
  replies["/cloud/api/v1/desktop/profiles"] = { status: 200, body: { profiles: [] } };
  const first = render(<DownloadsPage navigate={() => undefined} />);
  expect(await screen.findByText("There are no Desktop downloads for this workspace.")).toBeInTheDocument();
  first.unmount();
  replies["/cloud/api/v1/desktop/profiles"] = { status: 404, body: { error: "not_found", message: "Not found" } };
  render(<DownloadsPage navigate={() => undefined} />);
  expect(await screen.findByText("There are no Desktop downloads for this workspace.")).toBeInTheDocument();
});

it("reports a refused manifest", async () => {
  replies[`${FEED}/manifest?channel=stable`] = {
    status: 403,
    body: { error: "not_entitled", message: "Not entitled to this profile" },
  };
  render(<DownloadsPage navigate={() => undefined} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Not entitled to this profile");
});

it("matches only the downloads path under the app path", () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { appPath: "/cloud/dashboard/" };
  try {
    expect(isDownloadsPath("/cloud/dashboard/downloads")).toBe(true);
    expect(isDownloadsPath("/cloud/dashboard/downloads/")).toBe(true);
    expect(isDownloadsPath("/cloud/dashboard/")).toBe(false);
    expect(isDownloadsPath("/cloud/dashboard/sessions/downloads")).toBe(false);
  } finally {
    delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
  }
});
