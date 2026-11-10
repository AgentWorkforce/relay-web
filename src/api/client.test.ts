import { afterEach, expect, it, vi } from "vitest";
import { getAccount, getSessions, read, ReadError, SignedOut } from "./client";
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
it("uses the browser cookie and distinguishes signed-out from an outage", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false })),
    )
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  await expect(getAccount(signal())).rejects.toBeInstanceOf(SignedOut);
  expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
  expect(fetch.mock.calls[0][0]).toBe("/cloud/api/auth/session?renew=0");
  await expect(getAccount(signal())).rejects.not.toBeInstanceOf(SignedOut);
});
it("keeps failed history reads distinct from an empty session list", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], nextCursor: null, error: true }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(getSessions("w/other", "page+2", signal())).rejects.toThrow(
    "temporarily unavailable",
  );
  expect(fetch.mock.calls[0][0]).toBe(
    "/cloud/api/v1/workspaces/w%2Fother/sessions?metadata=deferred&cursor=page%2B2",
  );
});

it.each([400, 403, 501, 503])("preserves HTTP %i with the server reason", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    Response.json({ error: "unsupported_by_backend", reason: "agent_filter_not_ready" }, { status }),
  ));
  const failure = await read("/v1/workspaces/w/sessions?agent=builder", signal()).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ReadError);
  expect(failure).toMatchObject({ code: "agent_filter_not_ready", status });
});

it("keeps the ReadError status optional for existing callers", () => {
  expect(new ReadError("Existing refusal", "refused").status).toBeUndefined();
});
