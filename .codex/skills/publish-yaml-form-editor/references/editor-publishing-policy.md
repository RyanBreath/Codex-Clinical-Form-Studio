# Editor and publishing policy

## Supported project surface

- Work in `yaml-form-studio/`; do not initialize a second Sites project.
- Treat `.openai/hosting.json` as the canonical Sites project reference.
- Preserve React, the existing Sites project identity, the package lock where compatible, authenticated approval behavior, and the renderer's visual language.
- Use `template/crf/` as the reference for a Vite-based production build that emits static HTML, JavaScript, and CSS.
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

## Static rendering contract

- Compile the React editor before deployment and emit `index.html`, JavaScript, CSS, static assets, an asset manifest, and checksums.
- Do not parse YAML into React components or HTML on the Sites backend at request time.
- Do not depend on React SSR, RSC, Worker-generated HTML, or runtime TSX／TypeScript transpilation.
- A Worker or API route may handle authenticated confirmation, CDASH lookup, authorized persistence, or audit logging only.
- Test the production bundle from a static origin and verify that the form loads when rendering APIs are unavailable.
- The bundle deployed by Sites must match the manifest and checksums recorded by QA.

## Publishing gate

1. Preserve the existing Sites project ID and use a static React production build configuration.
2. Produce HTML, JavaScript, CSS, static assets, a manifest, and checksums before deployment.
3. Run the relevant tests against the built bundle using synthetic YAML.
4. Keep environment secrets in Sites runtime configuration.
5. Use private deployment when available.
6. Request approval before publishing with shared or public access.
7. Return the deployed URL only after Sites reports successful deployment of the QA-validated bundle.
