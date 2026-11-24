import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const dist = fileURLToPath(new URL("../../dist", import.meta.url));
const markers = [
  "Northstar Studio",
  "design_request_blocked",
  "synthetic_service_unavailable",
  "design-session-1",
  "tools/design/",
  "fx-ws-synthesis",
];
const entries = await readdir(dist, { recursive: true, withFileTypes: true });
await readFile(join(dist, "index.html"));
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const path = join(entry.parentPath, entry.name);
  if (!/\.(?:js|css|html|json|map)$/.test(path)) continue;
  const content = await readFile(path, "utf8");
  if (markers.some((marker) => content.includes(marker))) {
    throw new Error(
      `Design tooling leaked into production: ${relative(dist, path)}`,
    );
  }
}
console.log(
  "Production assets contain no design fixture or workbench markers.",
);
