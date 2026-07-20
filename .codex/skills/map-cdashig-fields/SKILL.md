---
name: map-cdashig-fields
description: Map reviewed clinical form fields to CDASHIG v2.1 candidates using official CDISC Library or CDISC website metadata tables, present evidence-backed candidates for specialist selection, and write only approved coding back to YAML. Use when Codex must search CDASHIG tables, suggest CDASH domains or variables, standardize eCRF field metadata, or review unresolved CDASH mappings without AI-generated coding.
---

# Map CDASHIG Fields

Map form fields to CDASHIG v2.1 with a human review gate. Treat every search result as a candidate, never as an approved mapping.

## Resolve inputs

Require:

- one local YAML file or an explicit field inventory;
- field label, concept ID or purpose, and protocol source locator;
- the selected form and project ID when working inside a protocol-to-eCRF project;
- confirmation that CDASHIG v2.1 is the target standard.
- an authenticated reviewer identity when the user asks to confirm or write an approved YAML.

If any required item is missing, ask the user for it before searching. Exclude direct identifiers and never use participant data as search input.

## Search official metadata

Read [references/cdashig-v2.1-policy.md](references/cdashig-v2.1-policy.md) before searching.

1. Prefer an authenticated official CDISC Library API when configured.
2. Otherwise inspect the official CDISC CDASHIG v2.1 page and its published metadata table or export.
3. Search label, question text, prompt, definition, CDASH variable, and SDTM target.
4. Record the exact source URL, standard version, table/domain, retrieval time, and matched text attributes.
5. Do not treat general web search snippets, blogs, or fuzzy similarity as authoritative evidence.

## Present candidates

For each candidate show:

- CDASH domain and variable;
- standard variable label, question text or prompt;
- data type;
- SDTM target and mapping instructions when published;
- controlled terminology codelist when published;
- source URL and evidence fields;
- confidence and unresolved differences.

Do not infer requiredness, unit, range, schedule, options, or clinical meaning from CDASH metadata. Preserve those from the protocol or leave them unresolved.

## Apply specialist selection

Wait for an explicit candidate selection. After selection, write the approved mapping to the field coding block with `standard: CDISC`, `model: CDASHIG`, `version: "2.1"`, domain, variable, source, and rationale. Keep rejected candidates outside the canonical mapping or record them as review history.

When producing a confirmed `program.yaml`, populate the applicable existing approval record's `approved_by` from the authenticated login identity and `approved_at` with an ISO 8601 timestamp. Never infer an identity from Git configuration, the operating-system account, protocol metadata, or free text. If the application cannot provide a verified identity, keep the approval pending and ask the user to sign in or supply the required authenticated context.

Keep `coding.status: unresolved` when no exact safe candidate exists. Use `matched` only after specialist selection. Use `not-applicable` only with an explicit rationale.

## Stop conditions

Stop and ask when the source table is unavailable, the field lacks a protocol locator, multiple plausible mappings remain, the CDASH version is unclear, or applying a candidate would change unsupported clinical semantics.
