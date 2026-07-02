# docs/history — provenance, not guidance

Everything in this folder is **historical**: executed one-shot build prompts,
completed design docs, and the retired 2025 review-team agent definitions.

- These documents describe the project **as it was when they were written**.
  Feature status, scope rules, and file paths in them may be obsolete.
- **They are not live guidance.** When anything here contradicts the root
  `CLAUDE.md`, `CLAUDE.md` wins. Do not execute build plans from this folder.
- Kept for traceability: they explain *why* things are shaped the way they are.

Contents:

- `agents/` — the retired one-time EMOS specialist review team (reviewers,
  synthesizer, implementer) plus a snapshot of the CLAUDE.md they ran against
  (`CLAUDE_MD_2025_REVIEW_SNAPSHOT.md`). That snapshot still says Analysis and
  Training Log must be hidden — **that rule is dead**; all modules are active.
- `emos/` — executed design-system and module build prompts (tokens,
  primitives, planner phases 5A–5D, exercise library, macro wiring, rename).
- `EXERCISE_TREE_DESIGN.md` — exercise hierarchy design; built and shipped in
  v0.18.0.
