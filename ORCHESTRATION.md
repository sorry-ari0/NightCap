# Agent Orchestration

This repo is coordinated through chat.dev agents. The chat.dev scheduler wakes agents hourly, but the agents must still follow a single authority model to avoid duplicate work, conflicting pushes, and unclear ownership.

## Current Audit

- `NightCap-Builder` (`vaY43uCwibli17C8g4l9A`) is the primary controller for `sorry-ari0/NightCap`.
- `NightCap` (`3QqbiEIH_C8vTXxYSafRG`) is a NightCap app lane agent. It may audit or implement scoped NightCap work only after coordination.
- `nightcap-critique` (`xpYXCbiMYOycddLVaHK_8`) is the critique/content lane and currently acts as the best visible match for Instagram/content research.
- `video-style-editor` (`13OhgJENcE3HkBAIzjB_e`) is the video-style-editor lane.
- `video-editor-mp4-scout` (`XJGI5N2_hvdh1f8cDC9W4`) is the MP4/media workflow lane.
- chat.dev metadata does not currently express a strict parent/child hierarchy for these agents. Most visible agents have `createdByAgentId: null`, so coordination has to be enforced by prompt contract and scheduled checks.

## Authority Model

1. `NightCap-Builder` is the global coordinator.
2. Lane agents own only their lane:
   - NightCap app QA and implementation.
   - Instagram/content research and workflow design.
   - Video editor style workflow.
   - Video editor MP4/media workflow.
3. Lane agents may inspect, test, and propose changes independently.
4. Lane agents must not push, merge, deploy, publish externally, delete data, or run destructive git commands without explicit coordination from `NightCap-Builder`.
5. If two agents see the same issue, the first agent to report it owns the investigation unless the coordinator reassigns it.

## Hourly Loop

The scheduler should wake and/or message each orchestration agent every hour. Each tick must:

1. List visible agents through the chat.dev integration when available.
2. Report each relevant agent's status: running/stopped/errored, current activity, repo, branch, dirty state, blocker, and next task.
3. Coalesce duplicate ticks. If an agent receives both a restart prompt and a message prompt within five minutes, it must treat them as one hourly tick.
4. Fix only small, safe blockers inside the agent's lane.
5. If there is no active work left, create exactly one concrete next task for that lane.
6. Report status back to the coordinator.

## Task Assignment Rules

- Assign tasks as small, verifiable units with an owner and write scope.
- Prefer read-only audits unless implementation is explicitly requested or clearly necessary.
- Use separate branches for implementation work.
- Run relevant checks before reporting completion.
- Keep the repo clean or report exactly why it is dirty.
- Do not overwrite or revert another agent's work.

## Verification Rules

- Use Playwright/browser verification for user-facing web behavior.
- Use `npm run release:check` before NightCap releases.
- For NightCap, public live health should remain `{"ok":true}`.
- Any external publishing flow, including Instagram/content automation, must be dry-run only unless the user explicitly asks to publish.

## Escalation

Escalate to the coordinator when:

- A lane has no safe next task.
- A task requires credentials, billing, or external publishing.
- A repo has uncommitted changes from another agent.
- CI, deploy, or local tests fail for reasons outside the lane's scope.
- An agent receives conflicting instructions.
