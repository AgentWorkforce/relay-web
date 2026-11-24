"use client";

import { MoreHorizontalIcon, Share08Icon } from "../../../shell/shell-icons";
import { AppShell, BarTitle, Icon, type AppShellProps } from "../../screens/app-shell/component";

/*
 * App Shell Flat – the same frame as App Shell Inset, laid flat.
 * No rounded panel: the sidebar keeps its gray fill and the main area runs edge to edge next to it, split by a single hairline.
 * A header runs across the top, like Claude's: the workspace and the sidebar toggle, the page's title and actions.
 * The flat look itself lives in App Shell Inset (layout="flat"); this adds the header. Everything else – menu, projects, what's new, onboarding progress, user menu, collapsing, resizing, the optional
 * work area on the right, the drawers on narrow screens and dark mode – comes from App Shell Inset, so screens built
 * on either look the same inside.
 */

/** The header Flat starts with: the open page's name as its title, share and more on the right – pass your own, or false for none */
const defaultHeader = (active?: string): AppShellProps["header"] => ({
  title: <BarTitle>{active ?? "Home"}</BarTitle>,
  actions: (
    <>
      <button className="ui-as-icon-btn" type="button" aria-label="Share">
        <Icon icon={Share08Icon} size={16} />
      </button>
      <button className="ui-as-icon-btn" type="button" aria-label="More">
        <Icon icon={MoreHorizontalIcon} size={16} />
      </button>
    </>
  ),
});

export function AppShellFlat({ header, ...props }: AppShellProps) {
  return <AppShell {...props} layout="flat" header={header ?? defaultHeader(props.active)} />;
}
