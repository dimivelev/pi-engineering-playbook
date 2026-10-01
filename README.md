# Pi Engineering Playbook

An installable Pi extension and skill for delivering software in small, verifiable slices. Version 0.2.0 adds runtime gates alongside session workflow commands and a compact prompt section. The bundled skill contains the complete research-informed playbook and all 25 workflows adapted from Addy Osmani's agent-skills.

## Install

Requires Git, Bash, Node.js 22.19 or newer, a Git working tree for verification, and **Pi 0.99.1 or newer**, from `@earendil-works/pi-coding-agent`. Version 0.99.1 is the tested host. Linux/macOS are the intended verification environments. Older `@mariozechner` releases, Windows verification, and other Pi forks are not tested.

From a local checkout:

```bash
pi install ./pi-engineering-playbook
```

From GitHub:

```bash
pi install git:github.com/dimivelev/pi-engineering-playbook
```

For a private repository, Pi's git process needs your existing GitHub authentication. Add `--local` to install for one project. Start a new Pi session or run `/reload` after installation. The package exposes both the extension and the `engineering-delivery` skill. No compilation step or extra runtime service is required.

To try only the extension in a checkout:

```bash
pi --extension ./extensions/index.ts
```

## Use

```text
/engineering plan Add CSV export with a date filter
/engineering build Implement the approved CSV export
/engineering review Check the current diff and integration gaps
/engineering release Assess readiness for version 1.0
/engineering status
/engineering off
/engineering on
/engineering reset
/skill:engineering-delivery
```

The playbook and runtime gates are enabled by default. `/engineering off` disables the gates and automatic prompt contribution; the skill remains available for explicit use. The setting belongs to the current session branch and survives resume/reload. A new session starts enabled. A workflow command re-enables it. Only a user command can turn the gates off or reset the plan. Commands that start work or change the setting require an idle agent.

| Command | Result |
| --- | --- |
| `plan <objective>` | Acceptance criteria, dependency order, slice types, integration checkpoints, and verification plan; stops before implementation |
| `build <objective>` | Implements and verifies the requested outcome using available project tools and authorized scope |
| `review <scope>` | Findings and verification gaps; stops before fixes unless requested |
| `release <scope>` | Readiness checks, blockers, rollout and rollback plan; authorizes preparation only |
| `on`, `off`, `status` | Controls or shows session workflow state |
| `reset` | Explicitly discards the current runtime plan; leaves project files intact |
| no argument or `help` | Command usage |

## Runtime enforcement

The model uses the registered `engineering_workflow` tool. The normal sequence is `plan → start → work → verify → complete` for each slice. A small task can use one slice and one meaningful check. The `/engineering plan` command has a separate plan-only stopping point and blocks implementation.

Before a slice is active, the extension blocks `edit`, `write`, **all shell commands**, and other non-read tools. It does not try to infer whether an arbitrary shell command is harmless. `read`, `grep`, `find`, and `ls` stay available if enabled in the host; `engineering_workflow status` also lists project entries. If you use a custom `--tools` allowlist, include `engineering_workflow` or deliberately turn gates off.

The runtime checks require:

- Unique slice IDs, nonempty outcomes/acceptance, an acyclic dependency graph, and one active slice.
- A named consumer/checkpoint for horizontal slices; an integration/e2e check for vertical slices.
- Verification executed by the extension using the exact commands in the plan. Caller-supplied success flags and evidence are ignored.
- Exit code zero, no cancellation/timeout, and an unchanged project fingerprint during a check.
- Fresh evidence for the active slice and previously verified slices before completing the next integration checkpoint. Use `verify` without `sliceId` to recheck all nonblocked slices.

Every non-read tool call invalidates evidence. The fingerprint covers Git HEAD, tracked files, and nonignored untracked files, including their paths, modes, contents and symlink targets as link text. External edits are detected on completion. Restoring a session/branch preserves its plan but requires checks to run again. Verification blocks other non-read tool calls while it runs; outstanding tool calls must finish before workflow state can change.

Unchecked final assistant answers are replaced with an explicit incomplete status. The extension requests at most two repair turns, then leaves an incomplete report rather than looping. A concrete `blocked` record can stop work, but the final runtime report identifies the workflow as blocked. Aborted/error runs are not automatically continued. Plans cannot be silently replaced; the user can `/engineering reset` for a new task.

Example arguments for the model's first tool call:

```json
{
  "action": "plan",
  "slices": [{
    "id": "V1",
    "kind": "vertical",
    "outcome": "CSV download includes only the signed-in user's selected date range",
    "acceptance": ["Other users' records never appear", "The actual request handler produces valid CSV"],
    "dependsOn": [],
    "checks": [{ "id": "export", "command": "npm run test:integration -- export", "kind": "integration" }]
  }]
}
```

Then `{"action":"start","sliceId":"V1"}`, project tools, `{"action":"verify"}`, and `{"action":"complete"}`. If a required service is unavailable, use `{"action":"blocked","sliceId":"V1","reason":"The integration database is unavailable"}`.

## Enforcement limits

These gates enforce recorded process and execution evidence, **not all 25 workflows' semantic quality**. The model selects commands and labels check types; a weak or incorrectly labeled check can pass. Review the plan and checks against acceptance criteria. A successful command is not proof of correctness, security, production health, or a real end-to-end consumer flow.

This is not a security sandbox. Other extensions, user-entered shell commands, external processes, ignored files, contents behind symlinks, remote systems, and modifications to the extension/session itself are outside the guarantee. Commands may start background processes; the extension cannot establish quiescence for every subprocess. Prompt priority, release authorization, independent review, test adequacy, and research-backed judgment still need host permissions and human/project policies. Read-only tasks that never enter the runtime workflow receive guidance without completion gating.

## Horizontal and vertical slices

Use a **vertical slice** for a complete observable behavior through the layers it needs: for example, a signed-in user selects a date range, requests CSV, and downloads correct persisted data.

Use a **horizontal slice** for a bounded shared enabler: for example, a scoped query reused by CSV export and an identified future consumer. Record its contract, tests, immediate consumer, and next integration checkpoint. A completed layer alone does not mean the feature works end to end.

The playbook works through discovery, baseline, design, slicing, implementation, integration, verification/review, release preparation, and operational learning. Scale these stages to the task: a small edit should not create a large process.

## What runs automatically

The extension registers one command and one tool, listens for lifecycle/tool events, and contributes a dedicated structured prompt section. It preserves Pi's other prompt sections and active tools. The full playbook is loaded only when relevant. Loading the extension does not launch subprocesses, fetch resources, deploy, or modify project files. Verification tool calls execute planned Bash commands with a five-minute limit per check and host cancellation support.

Workflow commands instruct the model, while tool events and completion hooks enforce the recorded gates. Release readiness and actual deployment are distinct. The extension supplies no production deployment authorization. A custom forced system prompt can hide the workflow instructions even though tool gates remain registered; another extension can interfere with event handling.

## Development and verification

```bash
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

`check` runs strict TypeScript checking, command/state tests, failure/bypass/regression cases, and a real Pi loader/session check. The host check loads the package and skill, blocks an early write through Pi's actual event runner, executes a real verification command, and checks completion before/after evidence. No model request is sent. These checks do not measure model reasoning quality, production rollout, terminal rendering, or DeepSWE coding improvement.

Pi's host and TypeBox are peer dependencies with the documented `*` range; development versions are pinned for repeatable checks. `private: true` prevents accidental npm publishing while allowing installation from git or a local directory.

## References and attribution

- [Complete playbook and research bibliography](skills/engineering-delivery/references/AGENTS.md)
- [Bundled engineering-delivery skill](skills/engineering-delivery/SKILL.md)
- [Upstream agent-skills](https://github.com/addyosmani/agent-skills)
- [Official Pi extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Official Pi package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- [Attribution and evidence limits](NOTICE.md)

The workflow is informed by research, not benchmark-proven to improve every project. The playbook includes a proposed evaluation procedure; no empirical performance gain is claimed.
