# Pi Engineering Playbook

An installable Pi extension and skill for delivering software in small, verifiable slices. The extension adds session-aware workflow commands and a compact prompt section. The bundled skill contains the complete research-informed playbook and all 25 workflows adapted from Addy Osmani's agent-skills.

## Install

Requires Node.js 22.19 or newer and **Pi 0.99.1 or newer**, from `@earendil-works/pi-coding-agent`. Version 0.99.1 is the tested host. Older `@mariozechner` releases and other Pi forks are not tested.

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
/skill:engineering-delivery
```

The playbook is enabled by default. `/engineering off` stops its automatic prompt contribution on subsequent runs; the skill remains available for explicit use. The setting belongs to the current session branch and survives resume/reload. A new session starts enabled. A workflow command re-enables it. Commands that start work or change the setting require an idle agent, so they cannot silently change the active run's instructions.

| Command | Result |
| --- | --- |
| `plan <objective>` | Acceptance criteria, dependency order, slice types, integration checkpoints, and verification plan; stops before implementation |
| `build <objective>` | Implements and verifies the requested outcome using available project tools and authorized scope |
| `review <scope>` | Findings and verification gaps; stops before fixes unless requested |
| `release <scope>` | Readiness checks, blockers, rollout and rollback plan; authorizes preparation only |
| `on`, `off`, `status` | Controls or shows session workflow state |
| no argument or `help` | Command usage |

## Horizontal and vertical slices

Use a **vertical slice** for a complete observable behavior through the layers it needs: for example, a signed-in user selects a date range, requests CSV, and downloads correct persisted data.

Use a **horizontal slice** for a bounded shared enabler: for example, a scoped query reused by CSV export and an identified future consumer. Record its contract, tests, immediate consumer, and next integration checkpoint. A completed layer alone does not mean the feature works end to end.

The playbook works through discovery, baseline, design, slicing, implementation, integration, verification/review, release preparation, and operational learning. Scale these stages to the task: a small edit should not create a large process.

## What runs automatically

The extension registers one command and listens for session start, branch navigation, and `before_agent_start`. It contributes a dedicated structured prompt section, preserving Pi's other sections and active tools. The full playbook is loaded only when relevant. It does not launch subprocesses, fetch network resources, deploy anything, create agents, or modify project files merely by loading. User-requested engineering work can use Pi's existing tools.

The commands instruct the model; they are not a deterministic test runner, authorization system, or guarantee of delivery. Release readiness and actual deployment are distinct. Test results and production health must be observed using the project's real tools. A custom forced system prompt or another extension can change how prompt contributions reach the model.

## Development and verification

```bash
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

`check` runs strict TypeScript checking, command/state/dispatch tests, and a real Pi loader/session check. The host check uses isolated temporary configuration, loads the package through its manifest, discovers the extension and skill, tests prompt contribution and persisted disabling, and sends no model request. It does not test model reasoning quality, production rollout, or terminal rendering.

Pi's host package is a peer dependency with the documented `*` range; the development dependency pins 0.99.1 for repeatable checks. `private: true` prevents accidental npm publishing while allowing installation from git or a local directory.

## References and attribution

- [Complete playbook and research bibliography](skills/engineering-delivery/references/AGENTS.md)
- [Bundled engineering-delivery skill](skills/engineering-delivery/SKILL.md)
- [Upstream agent-skills](https://github.com/addyosmani/agent-skills)
- [Official Pi extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Official Pi package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- [Attribution and evidence limits](NOTICE.md)

The workflow is informed by research, not benchmark-proven to improve every project. The playbook includes a proposed evaluation procedure; no empirical performance gain is claimed.
