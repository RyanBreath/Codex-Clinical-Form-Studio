# CDASHIG v2.1 source policy

Use only official CDISC sources as mapping evidence:

- CDASHIG v2.1: https://www.cdisc.org/standards/foundational/cdash/cdashig-v2-1
- CDISC Library: https://library.cdisc.org/
- CDISC Library API documentation: https://www.cdisc.org/cdisc-library/api-documentation/oas3

CDISC Library access may require a free account and API key. Never place a key in client code, YAML artifacts, logs, or the repository. If API access is unavailable, use the official website metadata table or an official export supplied by the user.

Capture these columns when available: domain, CDASH variable, variable label, definition, question text, prompt, data type, SDTM target, mapping instructions, controlled terminology codelist, implementation notes, and version.

Website table content is reference metadata, not protocol evidence. It cannot supply missing clinical requiredness, units, ranges, visits, conditions, calculations, or answer choices.
