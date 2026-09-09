# Repository guidance

## Current scope

The user has authorized implementation and subagents. Read README.md and IMPLEMENTATION_PLAN.md for the design and docs/mathematics.md for the current scientific scope. Proceed with ordinary implementation, fixes, and validation within the agreed scope without repeating the earlier planning approval question. A hosted application has not yet been deployed.

Keep planned features distinct from implemented behavior. Preserve the distinction between a leading-flow approximation and the full corrected mathematical construction.

The first implemented field is the paper's isolated heat-exterior family with diagnostic parameters. It is not the complete leading vortex or a blowup simulation. Never substitute a decorative vortex while describing it as the source construction.

Run `npm run build`, `npm run test:science`, and relevant Playwright checks for implementation changes. Keep the small preview dataset reproducible; do not commit node_modules, dist, test outputs, or large generated datasets.

## Installed planning skill

The user requested installation of `grill-me`, not automatic execution of an interview. Invoke it when the user explicitly requests it.

- Entry point: `.agents/skills/grill-me/SKILL.md`.
- Required workflow: `.agents/skills/grilling/SKILL.md`.

The upstream entry point says to call a `Skill` tool with `grilling`. If the host does not expose such a tool, read the local `grilling/SKILL.md` and follow it directly. This is an invocation compatibility fallback; the vendored upstream files remain unmodified.

Treat a request to install or update a skill as installation work, not as a request to execute that skill. Follow current user instructions about scope and approvals when using the planning workflow.
