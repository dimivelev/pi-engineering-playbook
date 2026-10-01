export const STATE_TYPE = "engineering-playbook:settings";
export const SECTION = "engineering_playbook";

export type WorkflowAction = "plan" | "build" | "review" | "release";
export type Command =
  | { kind: "help" | "status" | "on" | "off" | "reset" }
  | { kind: "workflow"; action: WorkflowAction; objective: string }
  | { kind: "invalid"; message: string };

export const HELP = `Engineering Playbook
/engineering on | off | status | reset
/engineering plan <objective>
/engineering build <objective>
/engineering review <scope>
/engineering release <scope>
/skill:engineering-delivery loads the full delivery skill.
Workflow commands enable the playbook for this session. Release checks prepare readiness; deployment requires authorization.`;

export function parseCommand(args: string): Command {
  const match = args.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return { kind: "help" };
  const action = match[1].toLowerCase();
  const objective = (match[2] ?? "").trim();
  if (["help", "status", "on", "off", "reset"].includes(action)) {
    return objective
      ? { kind: "invalid", message: `${action} does not take an objective.` }
      : { kind: action as "help" | "status" | "on" | "off" | "reset" };
  }
  if (["plan", "build", "review", "release"].includes(action)) {
    return objective
      ? { kind: "workflow", action: action as WorkflowAction, objective }
      : { kind: "invalid", message: `Supply a scope: /engineering ${action} <objective>` };
  }
  return { kind: "invalid", message: `Unknown action: ${action}\n${HELP}` };
}

export function restoreEnabled(entries: readonly unknown[]): boolean {
  let enabled = true;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (item.type !== "custom" || item.customType !== STATE_TYPE || !item.data || typeof item.data !== "object") continue;
    const data = item.data as { version?: unknown; enabled?: unknown };
    if (data.version === 1 && typeof data.enabled === "boolean") enabled = data.enabled;
  }
  return enabled;
}

export function workflowContext(skillPath: string): string {
  return `Engineering Playbook is enabled for software work. Use the user's requested scope and stopping point; scale effort to risk and respect project instructions and tool permissions.
For significant engineering work, read the bundled skill at ${JSON.stringify(skillPath)} and only the relevant parts of its references/AGENTS.md. For a small edit, use a focused check.
Work through discovery, baseline, design, slicing, implementation, integration, verification/review, release preparation, and operational follow-up as applicable.
Prefer a small real vertical path. Bound horizontal enablers by contracts, named near-term consumers, tests, and an integration checkpoint. Never claim a shared layer alone completes a feature. Give tasks acceptance criteria, dependencies, verification, and integration destinations.
Inspect the current tree and preserve existing work. Implement coherent slices and verify actual boundaries, persistence, failure behavior, and critical user flows with available tools. Do not invent test results or suppress failures.
Report implemented, verified, ready for release, released, and observed healthy separately. Continue authorized work until its outcome is complete; deployment needs the user's authorization and live verification. Do not turn this workflow into a requirement for unrelated tasks.`;
}

export function workflowPrompt(action: WorkflowAction, objective: string, skillPath: string): string {
  const instructions: Record<WorkflowAction, string> = {
    plan: "Inspect the available project context. Produce acceptance criteria and a dependency-ordered plan with horizontal enablers, vertical behaviors, bounded risk spikes where needed, verification, and integration checkpoints. Label unknowns. Stop at a plan; do not implement.",
    build: "Implement and verify the requested outcome end to end within authorized scope. Establish the baseline, plan coherent slices, connect real components, run appropriate checks, review the diff, and report actual evidence and remaining gaps. Prepare release guidance where relevant; do not infer production deployment authorization.",
    review: "Review the requested scope for correctness, readability, architecture, security, performance, and missing integration evidence. Ground findings in source, reproductions, checks, or authoritative documentation. Report findings by severity with actionable fixes and verification gaps. Stop at the review unless fixes are requested.",
    release: "Assess release readiness for the requested scope: tested revision/artifact, CI, configuration, compatibility/migrations, rollback, smoke checks, and observability. Run available non-destructive verification. Report blockers and a concrete rollout plan. This command authorizes preparation only; do not publish, deploy, or apply production migrations."
  };
  return `Use the Engineering Playbook. Read the skill at ${JSON.stringify(skillPath)} and relevant reference sections.\n\n${instructions[action]}\n\nUser objective/scope:\n${objective}`;
}
