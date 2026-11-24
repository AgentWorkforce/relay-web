import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const repository = fileURLToPath(new URL("../..", import.meta.url));

// Separate entry and config: production never imports the fixture transport.
export default defineConfig(({ command }) => {
  if (command !== "serve")
    throw new Error(
      "The design workbench is development-only. Use npm run build for the product.",
    );
  return {
    root,
    // Keep production, designer and test optimizers from replacing one
    // another's dependency metadata while their servers are running.
    cacheDir: fileURLToPath(
      new URL("../../node_modules/.vite/design-workbench", import.meta.url),
    ),
    optimizeDeps: { include: ["react-markdown", "remark-gfm"] },
    publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "design-preview-entry",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            // No backend proxy, cookie login or mutation endpoint in this server.
            if (/^\/(cloud|login)(\/|\?|$)/.test(request.url ?? "")) {
              response.writeHead(404, { "Content-Type": "application/json" });
              response.end(JSON.stringify({ error: "design_transport_only" }));
              return;
            }
            if (/^\/preview\/[a-z-]+\//.test(request.url ?? "")) {
              request.url = `/preview.html${(request.url ?? "").includes("?") ? `?${request.url!.split("?")[1]}` : ""}`;
            }
            next();
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      allowedHosts: ["127.0.0.1", "localhost"],
      fs: {
        allow: [repository],
        deny: [
          ".env",
          ".env.*",
          "**/.git/**",
          "**/.local/**",
          "**/*.{pem,key,crt}",
        ],
      },
    },
  };
});
