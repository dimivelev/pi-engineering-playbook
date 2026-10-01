# Pi Engineering Playbook

Engineering skills for Pi, combining the 25 workflows adapted from [Addy Osmani's agent-skills](https://github.com/addyosmani/agent-skills) with stage handoffs and recovery inspired by [Machinist](https://github.com/owainlewis/machinist).

Version **0.3.0** uses **advisory mode by default**. It guides discovery, small horizontal/vertical slices, verification and review while preserving the agent's answer. Missing tooling becomes an explicit verification gap; it does not replace the answer or force repeated repair turns. Strict runtime gates are available by explicit choice.

## Install or update

Tested with `@earendil-works/pi-coding-agent` **0.99.1** and Node.js **22.19+**. The verification tool needs Git and Bash in a Git working tree. Ordinary advisory work does not require a formal plan or Git. Older `@mariozechner` releases, other Pi forks and Windows verification are not tested.

```bash
pi install git:github.com/dimivelev/pi-engineering-playbook
# If already installed:
pi update git:github.com/dimivelev/pi-engineering-playbook
```

Run `/reload` or start a new session. Existing v0.2 session snapshots migrate to advisory automatically; their plans remain available. To switch immediately in an updated running session:

```text
/engineering advisory
```

Local installation: `pi install ./pi-engineering-playbook`. Add `--local` for one project. Pi's Git process uses your local GitHub authentication. No background service or model call runs when loading this package.

## Use

```text
/engineering plan Add CSV export with date filtering
/engineering build Implement issue #42
/engineering review Check the diff and integration evidence
/engineering release Assess readiness for version 1.0
/engineering tickets owner/repository
/engineering status
/engineering advisory
/engineering strict
/engineering off
/engineering on
/engineering reset
/skill:engineering-delivery
```

| Command | Behavior |
| --- | --- |
| `plan <objective>` | Acceptance, dependencies, verification and integration checkpoints; explicitly stops before implementation |
| `build <objective>` | Implements and verifies within the authorized scope; reports actual evidence and remaining work |
| `review <scope>` | Findings and evidence gaps; stops before fixes unless requested |
| `release <scope>` | Readiness, rollout and recovery preparation; no implicit deploy, publish or production migration |
| `tickets <repository or scope>` | Reads existing tickets and recommends relevant next work |
| `advisory` | Enables guidance without plan prerequisites, rewritten final answers or forced repair turns |
| `strict` | Explicitly enables runtime edit/shell/completion gates |
| `off`, `on` | Disables/enables guidance; `on` retains the selected policy |
| `status`, `reset` | Shows state or explicitly clears the local plan; leaves project files intact |

Policy is saved on the session branch and restored on resume/tree navigation. New sessions start enabled in advisory mode. Workflow commands enable the skill without silently switching the selected policy. Commands that start work or change settings require an idle agent.

## When tools are missing

For example, if `uv` is absent, a virtual environment points to missing Python 3.12, and pytest/hatchling are unavailable:

1. Inspect the manifest and CI for a supported existing alternative.
2. Run available meaningful checks, such as syntax and diff checks, and label exactly what they prove.
3. Keep HTTP integration and wheel build explicitly unverified.
4. Continue independent work such as rendering, preserve changes, and give concrete recovery steps.

The default extension preserves the agent's useful final explanation. It does not impose a generic incomplete message or request extra repair turns. An unavailable check is not a passing check; advisory behavior does not authorize weakened tests or misleading completion claims. The agent still follows project requirements and the user's scope.

## Optional recorded workflow

For substantial work, `engineering_workflow` records `plan → start → work → verify → complete`. A small edit can use an inline plan and ordinary tools instead. Use existing issue URLs as the durable tracker; session records supplement them.

```json
{
  "action": "plan",
  "slices": [{
    "id": "V1",
    "kind": "vertical",
    "outcome": "Signed-in user downloads correctly scoped CSV",
    "acceptance": ["Other users' records never appear", "The real handler produces valid CSV"],
    "dependsOn": [],
    "issueUrl": "https://github.com/owner/repository/issues/42",
    "checks": [{"id":"export","command":"npm run test:integration -- export","kind":"integration"}]
  }]
}
```

Then use `start` with `sliceId`, project tools, `verify`, and `complete`. Horizontal enablers need a named consumer; vertical slices need an integration/e2e check. `verify` executes commands for the active or previously verified slices, with a five-minute limit per check. It records real successful exits and a Git-tree fingerprint. `complete` rejects missing or stale evidence in either policy: that action specifically claims verified completion, so a partial handoff uses a different action.

```json
{"action":"blocked","sliceId":"V1","reason":"HTTP integration needs the unavailable database; static checks passed"}
```

```json
{"action":"handoff","summary":"CSV handler implemented. HTTP integration remains unverified; rendering is next.","nextSteps":["Restore the project-supported test environment","Run the planned HTTP and wheel checks"]}
```

`handoff` saves a session record with linked issues, remaining slices, blockers and current passing-check evidence. It does not mark work complete, write files, publish or stop advisory work. Copy relevant evidence into the existing issue/report when that write is requested. In advisory mode the agent may revise a plan for a new task without requiring `/engineering reset`; previous snapshots remain in session history. Dependency order remains guidance, so an environment gap does not prevent starting another slice.

## GitHub issue tracking

`engineering_issues` provides read-only open/closed/all ticket lists and ticket details using the local authenticated `gh` CLI. Existing issues can contain acceptance criteria, slice checklists, blockers and PR links. Missing CLI/auth is reported once; local work can continue.

```json
{"action":"list","repo":"owner/repository","state":"open","limit":30}
```

```json
{"action":"view","repo":"owner/repository","number":42}
```

No auto-posting, closure, assignment, background polling or Projects board synchronization runs. Issue writes use ordinary GitHub tools when requested by the user. The ChatGPT GitHub connector credentials are not transferred to Pi. See [GitHub tracking guide](docs/github-tracking.md).

## Machinist integration

[Example commands, prompts and workflows](examples/machinist/) supply **plan → build → review** stages and an optional operator-selected approval before build. Machinist owns stage progression, history, artifact transfer and configured approvals; this package supplies engineering guidance and a Pi CLI adapter. It does not recreate the Machinist control plane.

On a worker:

1. Check out this package and run `npm ci --ignore-scripts`.
2. Install/authenticate Pi and choose its model using the normal worker configuration.
3. Replace paths in [config.toml](examples/machinist/config.toml), place the prompts beside the configuration, and register commands/workflows on the control plane and executors/repositories on the worker.
4. Submit an authorized task using your configured repository name and workflow.

```bash
machinist submit --workflow engineering-delivery --repo my-project \
  --title "Implement CSV export" --source-url https://github.com/owner/repository/issues/42
```

[scripts/machinist-pi.ts](scripts/machinist-pi.ts) reads the rendered task on stdin, runs Pi with this extension in an isolated extension loadout, streams output and forwards cancellation. `PI_ENGINEERING_PI_BINARY` can select the executable; trailing arguments in the executor command can select Pi's provider/model. Other discovered extensions are disabled for this example to avoid duplicate registrations; explicitly add needed worker extensions through trailing Pi arguments.

The adapter explains `MACHINIST_STEP_RESULT_PATH`, `MACHINIST_OUTPUT_DIR` and `MACHINIST_SCRATCH_DIR` to Pi. It removes a stale result before starting, propagates process failures and rejects a missing/invalid/oversized result. It accepts an honest `blocked` result with process exit zero, leaving progression decisions to Machinist. It does not independently certify the agent's claimed semantic quality. Required outputs are checked by Machinist, not inferred from text. A missing delivery check may pause the next stage after useful work and a report have been saved; it does not interrupt every tool call.

The adapter/contract is tested with a fake Pi subprocess, and the extension separately loads in the real Pi host. No live model-backed Machinist deployment has been run here. Configuration follows upstream Machinist commit `39435164faf1ff7fad49e41c38a7eb1a00538f21`; check its current docs before operating a different version.

## Explicit strict mode and limits

`/engineering strict` enables the v0.2-style gates: edits, all shell calls and other non-read tools need an active slice; only one slice is active; dependency prerequisites must be verified; existing plans require user reset. Read tools, issue lookup and workflow status remain available. The explicit plan-only command blocks implementation in both policies.

Strict mode replaces unchecked final answers, requests at most two repair turns and then records an incomplete status. Use advisory when you want practical partial handoffs. Verification locks non-read calls while it runs, and outstanding tools must finish before workflow state changes in either mode, to avoid recording checks during a concurrent edit.

Evidence is invalidated by non-read calls. Fingerprints cover Git HEAD, tracked files and nonignored untracked files: paths, modes, contents and symlink link text. External edits are detected when completing or recording a handoff; restored sessions require checks to run again. Ignored files, symlink referents, remote state and background processes are not fully covered.

The extension is not a security sandbox and cannot certify all 25 protocols' semantic quality. A model-selected weak or mislabeled check can pass. Other extensions, user-entered shell, external processes and modified extension/session files can bypass assumptions. Human/project review, host permissions and actual acceptance evidence remain necessary. Advisory mode deliberately allows useful work and clear unverified reports.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

Checks cover strict TypeScript, session migration, command scopes, advisory blocked-tooling handoffs, real verification/stale evidence, read-only issue arguments, the Machinist adapter's subprocess contract and a real Pi loader/session. No model request is sent. No DeepSWE coding improvement or productivity gain has been measured.

Pi and TypeBox are peer dependencies; development versions are locked. `private: true` prevents accidental npm publication while permitting Git/local installation.

## References

- [Full 25-workflow playbook and research bibliography](skills/engineering-delivery/references/AGENTS.md)
- [Engineering Delivery skill](skills/engineering-delivery/SKILL.md)
- [Addy Osmani's agent-skills](https://github.com/addyosmani/agent-skills)
- [Machinist workflow contract](https://github.com/owainlewis/machinist/blob/39435164faf1ff7fad49e41c38a7eb1a00538f21/docs/workflows.md)
- [Machinist artifacts](https://github.com/owainlewis/machinist/blob/39435164faf1ff7fad49e41c38a7eb1a00538f21/docs/artifacts.md)
- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Attribution and evidence limits](NOTICE.md)
