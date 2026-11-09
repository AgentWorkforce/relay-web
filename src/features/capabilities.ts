import { z } from "zod";
import { SignedOut } from "../api/client";

// relay-control's GET /api/v1/capabilities: what SELFHOST_FEATURES selects.
// Only this answer enables UI; nothing is decided in the browser.
const responseSchema = z.object({
  capabilities: z.object({
    flows: z.boolean(),
    chief: z.boolean(),
    relayfile: z.boolean(),
  }),
});
export type ProductCapabilities = z.infer<
  typeof responseSchema
>["capabilities"];
export const NO_CAPABILITIES: ProductCapabilities = Object.freeze({
  flows: false,
  chief: false,
  relayfile: false,
});

export async function getProductCapabilities(signal: AbortSignal) {
  const response = await fetch("/cloud/api/v1/capabilities", {
    signal,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) throw new SignedOut();
  if (!response.ok)
    throw new Error("Feature availability could not be checked.");
  return responseSchema.parse(await response.json()).capabilities;
}
