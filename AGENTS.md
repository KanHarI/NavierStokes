# Repository guidance

## Current scope

This project is in planning. Read README.md and IMPLEMENTATION_PLAN.md for the agreed design. Documentation, repository setup, and installation of the requested planning skill are authorized. Do not implement the numerical model, application, data generator, or deployment until the user authorizes implementation. A later explicit authorization supersedes this planning restriction; do not ask for approval again for work already authorized in the conversation.

Keep planned features distinct from implemented behavior. Preserve the distinction between a leading-flow approximation and the full corrected mathematical construction.

## Installed planning skill

The user requested installation of `grill-me`, not automatic execution of an interview. Invoke it when the user explicitly requests it.

- Entry point: `.agents/skills/grill-me/SKILL.md`.
- Required workflow: `.agents/skills/grilling/SKILL.md`.

The upstream entry point says to call a `Skill` tool with `grilling`. If the host does not expose such a tool, read the local `grilling/SKILL.md` and follow it directly. This is an invocation compatibility fallback; the vendored upstream files remain unmodified.

Treat a request to install or update a skill as installation work, not as a request to execute that skill. Follow current user instructions about scope and approvals when using the planning workflow.
