import "./styles.css";
import "../../src/brand.css";
import "../../src/styles.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/app";
import { initTheme } from "../../src/shell/theme";
import { scenarioId } from "./scenarios";
import { createFixtureFetch } from "./transport";

const scenario = scenarioId(location.pathname.split("/")[2]);
window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {
  appPath: `/preview/${scenario}/`,
  sessionAgentNames: true,
  sessionShortSummaries: true,
  sessionReadApi: false,
  analyticsEnabled: false,
};
// Never saved to cookies or storage, never imported by the production entry.
const fixtureFetch = createFixtureFetch(scenario, location.origin);
window.fetch = async (input, init) => {
  const response = await fixtureFetch(input, init);
  if (parent !== window) {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      location.origin,
    );
    parent.postMessage(
      {
        type: "design-read",
        path: url.pathname + url.search,
        status: response.status,
      },
      location.origin,
    );
  }
  return response;
};
initTheme();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
