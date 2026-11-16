import { Badge } from "../shell/ui";
import type { SessionGroup } from "./data";

/**
 * The owning relaygate group's label (for example "pit"), from the
 * deployment's policy. Display only: it says which group owns the session.
 */
export function GroupBadge({ group, className }: { group: SessionGroup | null; className?: string }) {
  if (!group) return null;
  return (
    <Badge
      variant="info"
      className={className}
      title={`Owned by the ${group.label} group`}
      aria-label={`Group: ${group.label}`}
    >
      {group.label}
    </Badge>
  );
}
