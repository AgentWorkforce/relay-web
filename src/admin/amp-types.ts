import type { z } from "zod";
import type { ampViewSchema } from "./remote-agent-api";
export type AmpView = z.infer<typeof ampViewSchema>;
export type AmpAction =
  | { kind: "connect"; key: string }
  | { kind: "discover" | "disconnect" }
  | { kind: "bind"; threadId: string }
  | { kind: "unbind"; id: string }
  | { kind: "check_delivery"; id: string; messageId: string };
export type AmpActionResult =
  | ({
      ok: true;
      threads?: Array<{ id: string; title: string }>;
    } & AmpView)
  | { ok: false; error: string };
