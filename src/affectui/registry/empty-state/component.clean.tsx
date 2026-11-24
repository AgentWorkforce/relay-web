"use client";

import { type ComponentPropsWithRef, type ReactNode, type ComponentType } from "react";
import { File } from "lucide-react";

/*
 * Empty State – a single self-contained file, clean style.
 * What a list, table or panel shows while there is nothing in it: an icon on a soft tile, a title, one line on what
 * will show up here, and a button for the first step. Framed in a quiet drop area, or bare inside a panel.
 * The styles are injected below, so no extra files are needed.
 */


export type EmptyStateProps = Omit<ComponentPropsWithRef<"div">, "title"> & {
  /** What's empty, e.g. "No schedules yet" */
  title: ReactNode;
  /** One line on what will show up here, or how to get there */
  text?: ReactNode;
  /** The first step – usually a small secondary Button; several buttons sit in a row */
  action?: ReactNode;
  /** The glyph on the tile: a Lucide icon or any element. Defaults to a file; null shows no tile */
  icon?: ReactNode | ComponentType;
  /** Without the frame – for a panel or page where it is the only content */
  bare?: boolean;
  /** Fills its parent's height and centres itself in it – for a list or table area that keeps its size */
  tall?: boolean;
};

export function EmptyState({ title, text, action, icon = File, bare, tall, className, ...rest }: EmptyStateProps) {
  return (
    <>
      {/* React 19 hoists this into <head> once, no matter how many render */}
      <style href="ui-empty-state-clean" precedence="default">
        {css}
      </style>
      <div className={["ui-estc", className].filter(Boolean).join(" ")} data-bare={bare || undefined} data-tall={tall || undefined} {...rest}>
        {/* icon={null}: no tile at all, the title moves up */}
        {icon != null && icon !== false && (
          <span className="ui-estc__icon" aria-hidden="true">
            <Glyph icon={icon} />
          </span>
        )}
        <p className="ui-estc__title">{title}</p>
        {text != null && text !== false && <p className="ui-estc__text">{text}</p>}
        {action != null && action !== false && <div className="ui-estc__action">{action}</div>}
      </div>
    </>
  );
}

// Agent Relay: icons are Lucide components (the dashboard's one icon family), drawn at 16px; any other element as it is
const isIconComponent = (icon: unknown): icon is ComponentType<{ size?: number; "aria-hidden"?: boolean }> =>
  typeof icon === "function" || (typeof icon === "object" && icon !== null && "$$typeof" in icon && "render" in icon);

function Glyph({ icon }: { icon: ReactNode | ComponentType }) {
  if (isIconComponent(icon)) {
    const Lucide = icon as ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
    return <Lucide size={16} aria-hidden />;
  }
  return <>{icon as ReactNode}</>;
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors as variables – override them on .ui-estc (see Theming in the docs) */
.ui-estc {
  --ui-estc-title: var(--aui-ink, #000000);
  --ui-estc-text: var(--aui-muted, rgba(32, 40, 46, 0.45));
  --ui-estc-icon: var(--aui-muted, rgba(32, 40, 46, 0.45));
  --ui-estc-tile: var(--aui-subtle, rgba(29, 79, 122, 0.04));
  --ui-estc-frame: rgba(29, 79, 122, 0.02);
  --ui-estc-line: var(--aui-border, rgba(29, 79, 122, 0.06));

  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  min-width: 0;
  padding: 48px 24px 52px;
  border-radius: var(--aui-radius-lg, 12px);
  background: var(--ui-estc-frame);
  box-shadow: inset 0 0 0 0.5px var(--ui-estc-line);
  font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
  -webkit-font-smoothing: antialiased;
}
/* bare: no frame – the panel or page around it is the frame */
.ui-estc[data-bare] {
  padding: 0;
  background: none;
  box-shadow: none;
}
/* tall: fills its parent's height, the content in the middle */
.ui-estc[data-tall] {
  justify-content: center;
  min-height: 100%;
}

.ui-estc__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--ui-estc-tile);
  color: var(--ui-estc-icon);
}
.ui-estc__icon > svg,
.ui-estc__icon > img {
  display: block;
  width: 18px;
  height: 18px;
}
.ui-estc__title {
  max-width: 100%;
  margin: 0;
  font-weight: 500;
  color: var(--ui-estc-title);
  overflow-wrap: anywhere;
}
.ui-estc__icon + .ui-estc__title { margin-top: 16px; }
.ui-estc__text {
  max-width: 430px;
  margin: 4px 0 0;
  color: var(--ui-estc-text);
  text-wrap: balance;
  overflow-wrap: anywhere;
}
.ui-estc__action {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 18px;
}

/* Small screens: a tighter frame */
@media (max-width: 560px) {
  .ui-estc:not([data-bare]) {
    padding: 36px 18px 40px;
  }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-estc {
  --ui-estc-title: var(--aui-ink, #ffffff);
  --ui-estc-text: var(--aui-muted, rgba(255, 255, 255, 0.45));
  --ui-estc-icon: var(--aui-muted, rgba(255, 255, 255, 0.45));
  --ui-estc-tile: var(--aui-subtle, rgba(255, 255, 255, 0.06));
  --ui-estc-frame: rgba(255, 255, 255, 0.03);
  --ui-estc-line: var(--aui-border, rgba(255, 255, 255, 0.08));
}
`;
