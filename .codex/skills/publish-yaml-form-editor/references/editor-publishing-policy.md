# Editor and publishing policy

## Supported project surface

- Work in `yaml-form-studio/`; do not initialize a second Sites project.
- Treat `.openai/hosting.json` as the canonical Sites project reference.
- Preserve Vinext, React, the existing package lock, `app/chatgpt-auth.ts`, and the renderer's visual language.
- Accept `protocol-to-ecrf` `program.yaml`. Route other YAML formats through an explicit conversion before rendering.

## Required editor behavior

- Load YAML by upload or paste and keep the raw text visible.
- Synchronize YAML, selected-field controls, diagnostics, and renderer preview.
- Default to English and provide an English/Chinese switch.
- Keep YAML field content in English unless a bilingual value is explicitly supplied.
- Expose a per-field `Search CDASH` action that calls `map-cdashig-fields`.
- Show candidates with source evidence and require a human choice before updating YAML.
- Keep confirmation disabled when the reviewer is not authenticated or blocking unresolved items remain.
- Stamp confirmed YAML from server-verified identity headers, never from editable client state.

## Authentication and storage

Use the Sites platform identity path already implemented by `app/chatgpt-auth.ts`. Perform authorization and confirmation checks server-side.

Use browser state only for temporary drafts. If users need shared drafts, cross-session recovery, ownership, review history, or concurrent editing, use Sites D1 with server-side ownership checks and migrations. Do not store authoritative shared form data only in `localStorage`, `sessionStorage`, or component memory.

## Publishing gate

1. Preserve the existing Sites project and build configuration.
2. Run the deployment build and relevant tests against synthetic YAML.
3. Keep environment secrets in Sites runtime configuration.
4. Use private deployment when available.
5. Request approval before publishing with shared or public access.
6. Return the deployed URL only after Sites reports successful deployment.
