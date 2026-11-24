// The operator area's pages (the wide sidebar's menu) and their design versions. Each page keeps its
// own version: ?page=overlaps&v=2. Moving to another page restores the version last chosen there.
// Pages belong to an area of the workbench rail: "operator" (/operator/<scenario>/) or "dashboard"
// (/dashboard/<scenario>/, the redesign of the team dashboard). The sidebar lists one area's pages.
export const PAGES = [
  { id: "overview", area: "operator", label: "Overview", versions: ["List", "Briefing", "Board"] },
  { id: "overlaps", area: "operator", label: "Overlaps", versions: ["List", "Pairs", "Matrix"] },
  { id: "spend", area: "operator", label: "Spend", versions: ["Page"] },
  { id: "map", area: "operator", label: "Map", versions: ["Flow", "Trees", "Pairs"] },
  { id: "home", area: "dashboard", label: "Overview", versions: ["Page"] },
  { id: "sessions", area: "dashboard", label: "Sessions", versions: ["Page"] },
  { id: "people", area: "dashboard", label: "People", versions: ["Page"] },
] as const;
export type PageId = (typeof PAGES)[number]["id"];
export type Area = (typeof PAGES)[number]["area"];

/** The area this page is served in – from the path: /operator/… or /dashboard/… */
export const areaFrom = (path: string): Area => (path.split("/")[1] === "dashboard" ? "dashboard" : "operator");
export const pageFrom = (id: string | null, area: Area = areaFrom(location.pathname)) =>
  PAGES.find((p) => p.id === id && p.area === area) ?? PAGES.find((p) => p.area === area)!;

const key = (page: PageId) => `agent-relay.operator.version.${page}`;
export function rememberVersion(page: PageId, v: string) {
  try {
    localStorage.setItem(key(page), v);
  } catch {
    // Storage blocked – the version just isn't remembered
  }
}
function rememberedVersion(page: PageId) {
  try {
    return localStorage.getItem(key(page));
  } catch {
    return null;
  }
}

/** Opens a page, on the version last chosen there; scenario and period stay as they are */
export function openPage(page: PageId) {
  const url = new URL(location.href);
  const area = PAGES.find((p) => p.id === page)!.area;
  url.pathname = url.pathname.replace(/^\/(operator|dashboard)\//, `/${area}/`);
  url.searchParams.set("page", page);
  url.searchParams.set("v", rememberedVersion(page) ?? "1");
  location.href = url.href;
}
