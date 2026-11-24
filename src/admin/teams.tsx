// Settings > Teams: owners and admins group the people of an organization
// into teams (relay-control /organizations/{id}/teams, behind the `teams`
// capability). One team per person: choosing another team moves them.
import { useState, type FormEvent } from "react";
import { adminApi, ApiError } from "./api";
import { MAX_TEAM_NAME_LENGTH, type Member, type Team } from "./contracts";
import { message, useLoad } from "./use-load";

type Notice = {
  card: "teams" | "people";
  kind: "status" | "alert";
  text: string;
};

/** Control's teams codes as short sentences; anything else stays generic. */
export function teamErrorText(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "team_name_taken":
        return "That name is already in use by another team.";
      case "team_archived":
        return "That team was archived.";
      case "team_not_found":
        return "That team no longer exists.";
      case "membership_not_found":
        return "That person is no longer a member of this organization.";
      case "feature_not_enabled":
        return "Teams are not enabled on this installation.";
    }
  }
  return message(error);
}

/** Codes after which the lists shown are out of date. */
const STALE = new Set(["team_archived", "team_not_found", "membership_not_found"]);

const personName = (member: Member) => member.name || member.email || "Unknown member";
const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

export function TeamsSection(props: {
  organizationId: string;
  organizationName: string;
}) {
  const teams = useLoad((signal) => adminApi.teams(props.organizationId, signal));
  const members = useLoad((signal) =>
    adminApi.members(props.organizationId, signal),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  // A write's refresh must land before the next action: until then the lists
  // (and each person's current team) are out of date.
  const locked = busy || teams.pending || members.pending;

  function reloadAll() {
    teams.reload();
    members.reload();
  }

  /**
   * Runs one write; its outcome (a status text, or a notice of its own kind)
   * and any refusal are shown in the card the action came from.
   */
  async function run(
    card: Notice["card"],
    action: () => Promise<string | Omit<Notice, "card">>,
  ): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await action();
      setNotice(
        typeof outcome === "string"
          ? { card, kind: "status", text: outcome }
          : { card, ...outcome },
      );
      reloadAll();
      return true;
    } catch (error) {
      setNotice({ card, kind: "alert", text: teamErrorText(error) });
      if (error instanceof ApiError && STALE.has(error.code)) reloadAll();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const wanted = name.trim();
    if (locked || !wanted) return;
    const created = await run("teams", async () => {
      const team = await adminApi.createTeam(props.organizationId, wanted);
      return `Created the team ${team.name}.`;
    });
    if (created) setName("");
  }

  async function rename(event: FormEvent, team: Team) {
    event.preventDefault();
    const wanted = renaming?.name.trim() ?? "";
    if (locked || !wanted) return;
    const renamed = await run("teams", async () => {
      const next = await adminApi.renameTeam(props.organizationId, team.id, wanted);
      return `Renamed ${team.name} to ${next.name}.`;
    });
    if (renamed) setRenaming(null);
  }

  function archive(team: Team) {
    if (
      locked ||
      !window.confirm(
        `Archive the team ${team.name}? Its ${people(team.memberCount)} will have no team. Past reports keep the team.`,
      )
    )
      return;
    if (renaming?.id === team.id) setRenaming(null);
    void run("teams", async () => {
      const result = await adminApi.archiveTeam(props.organizationId, team.id);
      return result.unassigned > 0
        ? `Archived ${team.name}. ${people(result.unassigned)} now ${result.unassigned === 1 ? "has" : "have"} no team.`
        : `Archived ${team.name}.`;
    });
  }

  function choose(member: Member, teamId: string) {
    const list = teams.data ?? [];
    const label = (id: string | null | undefined) =>
      list.find((team) => team.id === id)?.name ?? "another team";
    const current = member.teamId ?? null;
    const who = personName(member);
    if (locked || teamId === (current ?? "")) return;
    void run("people", async () => {
      if (!teamId && current) {
        const result = await adminApi.unassignTeamMember(
          props.organizationId,
          current,
          member.userId,
        );
        // Not in that team any more (another admin moved them): the reload
        // that follows shows where they are.
        if (!result.unassigned)
          return {
            kind: "alert",
            text: `${who} was no longer in ${label(current)}. The list has been refreshed.`,
          };
        return `Removed ${who} from ${label(current)}. ${who} has no team now.`;
      }
      const result = await adminApi.assignTeamMember(
        props.organizationId,
        teamId,
        member.userId,
      );
      const left = result.previousTeamId;
      return left && left !== teamId
        ? `Moved ${who} from ${label(left)} to ${label(teamId)}.`
        : `Added ${who} to ${label(teamId)}.`;
    });
  }

  const list = teams.data;
  const loadError = teams.error ?? members.error;
  const peopleCard = !!list && list.length > 0;
  const shown = (card: Notice["card"]) =>
    notice?.card === card ? <p role={notice.kind}>{notice.text}</p> : null;

  return (
    <>
      <section aria-labelledby="teams-title" className="card">
        <h2 id="teams-title">Teams</h2>
        <p>
          Group the people in {props.organizationName} into teams. Each person
          is in at most one team.
        </p>
        {loadError && (
          <p role="alert">
            {teamErrorText(loadError)}{" "}
            <button type="button" disabled={locked} onClick={reloadAll}>
              Try again
            </button>
          </p>
        )}
        <form className="inline-form" onSubmit={(event) => void create(event)}>
          <label>
            New team name
            <input
              value={name}
              maxLength={MAX_TEAM_NAME_LENGTH}
              disabled={locked}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button className="primary" type="submit" disabled={locked || !name.trim()}>
            Create team
          </button>
        </form>
        {shown("teams")}
        {/* Without the People card its notice (say, a team archived meanwhile) shows here. */}
        {!peopleCard && shown("people")}
        {!list && !teams.error && <p role="status">Loading teams…</p>}
        {list && list.length === 0 && (
          <p className="note">No teams yet. Create the first one above.</p>
        )}
        {list && list.length > 0 && (
          <table aria-label="Teams">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Members</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((team) => (
                <tr key={team.id} data-testid={`team-${team.id}`}>
                  {renaming?.id === team.id ? (
                    <td colSpan={3}>
                      <form
                        className="inline-form"
                        onSubmit={(event) => void rename(event, team)}
                      >
                        <label>
                          New name for {team.name}
                          <input
                            autoFocus
                            value={renaming.name}
                            maxLength={MAX_TEAM_NAME_LENGTH}
                            disabled={locked}
                            onChange={(event) =>
                              setRenaming({ id: team.id, name: event.target.value })
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setRenaming(null);
                              }
                            }}
                          />
                        </label>
                        <button
                          className="primary"
                          type="submit"
                          disabled={
                            locked ||
                            !renaming.name.trim() ||
                            renaming.name.trim() === team.name
                          }
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => setRenaming(null)}
                        >
                          Cancel
                        </button>
                      </form>
                    </td>
                  ) : (
                    <>
                      <td>{team.name}</td>
                      <td>{team.memberCount}</td>
                      <td className="actions">
                        <button
                          type="button"
                          aria-label={`Rename ${team.name}`}
                          disabled={locked}
                          onClick={() => {
                            setNotice(null);
                            setRenaming({ id: team.id, name: team.name });
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="danger"
                          aria-label={`Archive ${team.name}`}
                          disabled={locked}
                          onClick={() => archive(team)}
                        >
                          Archive
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {list && peopleCard && (
        <section aria-labelledby="team-members-title" className="card">
          <h2 id="team-members-title">People</h2>
          <p id="team-members-help">
            A person is in one team at a time. Choosing a team for someone who
            already has one moves them out of their current team.
          </p>
          {shown("people")}
          {!members.data && !members.error && (
            <p role="status">Loading members…</p>
          )}
          {members.data && members.data.length === 0 && (
            <p className="note">No members found for this organization.</p>
          )}
          {members.data && members.data.length > 0 && (
            <table aria-label="Team members">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Team</th>
                </tr>
              </thead>
              <tbody>
                {members.data.map((member) => {
                  const current = member.teamId ?? "";
                  const known = !current || list.some((team) => team.id === current);
                  return (
                    <tr key={member.userId} data-testid={`team-member-${member.userId}`}>
                      <td>
                        {personName(member)}
                        {member.name && member.email && (
                          <>
                            {" "}
                            <span className="note">{member.email}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <select
                          aria-label={`Team for ${personName(member)}`}
                          aria-describedby="team-members-help"
                          value={current}
                          disabled={locked}
                          onChange={(event) => choose(member, event.target.value)}
                        >
                          <option value="">No team</option>
                          {list.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                          {!known && (
                            <option value={current} disabled>
                              Unavailable team
                            </option>
                          )}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
