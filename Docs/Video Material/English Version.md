# Codex Clinical Form Studio — 3-Minute Demo Script

## 0:00–0:28 — The Clinical Trial Data Problem

**Voice-over:**

Clinical trials require accurate, standardized, and traceable data.

But converting a clinical study protocol into an electronic case report form, or eCRF, is still a highly manual process.

Clinical teams must interpret the protocol, identify the required data, design each field, define validation rules, and map the data to standards such as CDISC CDASH.

When the protocol changes, even a small amendment may affect several forms, field definitions, validation rules, and downstream analysis.

**Visual:**

Protocol → spreadsheets → manually created forms → disconnected mapping documents.

---

## 0:28–0:52 — Introducing the Solution

**Voice-over:**

We created Codex Clinical Form Studio.

It is not a single prompt that generates a form. It is a reusable plugin composed of specialized Skills.

The user uploads a protocol, and an Orchestrator Skill identifies the current stage and guides the user through protocol analysis, form design, CDASH mapping, clinical review, automated testing, and deployment.

Every stage has a defined input, output, and human approval point.

**Visual:**

Clinical Form Studio Plugin → Orchestrator → specialized Skills.

---

## 0:52–1:20 — GPT-5.6 and Protocol Analysis

**Voice-over:**

The workflow begins with the clinical study protocol.

The Orchestrator invokes the Protocol Analysis Skill, while GPT-5.6 provides the medical and logical reasoning.

GPT-5.6 identifies potential forms, fields, data types, units, required conditions, selectable options, and validation rules.

It converts these findings into a structured YAML specification.

This YAML becomes the single source of truth for the form, allowing clinical users to review and edit the specification through a web interface instead of modifying application code.

**Visual:**

Highlighted protocol content → GPT-5.6 analysis → YAML → Form Builder.

---

## 1:20–1:48 — Clinical Editing and CDASH Mapping

**Voice-over:**

Clinical users can add, remove, reorder, or modify fields directly in the interface.

They can change field types, required conditions, numeric limits, and selectable options.

The Orchestrator then invokes the CDASH Mapping Skill.

The system queries an authorized CDISC data source, and GPT-5.6 evaluates each field together with its protocol context.

It ranks the most relevant CDASH candidates and explains the reasoning behind each recommendation.

The AI suggests the mapping, but the final decision remains with the clinical professional.

**Visual:**

Edit the Weight field → search CDASH → ranked candidates → human approval.

---

## 1:48–2:10 — Generating an Executable eCRF

**Voice-over:**

After the specification is approved, the Form Generation Skill converts the YAML into a standardized JSON model.

The JSON-to-HTML renderer then generates an executable eCRF with the correct controls, required settings, allowed values, ranges, and validation behavior.

The generated form is first deployed to a validation environment, where the clinical team can review the actual user experience.

**Visual:**

YAML → JSON → renderer → executable eCRF.

---

## 2:10–2:36 — Codex Engineering and Automated QA

**Voice-over:**

Codex turns the approved clinical specification into maintainable engineering work.

The Orchestrator directs Codex to update the application, generate database migrations, create pytest and Playwright tests, and validate the form in a real browser.

The tests confirm that required fields cannot be skipped, numeric limits are enforced, valid options are available, and invalid values are rejected.

When a test fails, Codex traces the problem back to the YAML specification, the renderer, or the application implementation.

It applies the correction and runs the tests again.

**Visual:**

Codex code changes → pytest → Playwright → test failure → correction → all tests passed.

---

## 2:36–2:49 — Protocol Version Comparison

**Voice-over:**

When a new protocol version is uploaded, the Version Comparison Skill compares the previous and current YAML specifications.

It identifies added, removed, and modified fields, together with changes to required conditions, validation rules, options, and CDASH mappings.

This gives the clinical and engineering teams a clear record of every protocol amendment.

**Visual:**

Protocol version 1.0 versus 1.1 → field-level differences.

---

## 2:49–3:00 — GitHub and Deployment

**Voice-over:**

We use GPT-5.6 to interpret complex medical protocols and reason about CDISC mappings.

We use Codex to implement the application, write automated tests, resolve failures, and prepare GitHub pull requests.

After clinical approval and automated QA, the CI/CD pipeline deploys the validated eCRF to production.

Codex Clinical Form Studio packages the complete eCRF workflow into a reusable, testable plugin, while keeping humans in control of every critical clinical decision.

**Visual:**

Pull request → GitHub Actions → production eCRF.
