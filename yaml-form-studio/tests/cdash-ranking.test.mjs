import assert from "node:assert/strict";
import test from "node:test";
import {
  codingFromCandidate,
  companionFieldFromCandidate,
  rankCdashCandidates,
} from "../app/cdash.mjs";

const source = {
  version: "CDASH Model v1.3",
  sourceFile: "Docs/CDASH_Model_v1.3.csv",
  sourceUrl: "https://www.cdisc.org/standards/foundational/cdash/cdash-model-v1-3",
  retrievedAt: "2026-07-21T05:41:22.000Z",
};

const rows = [
  {
    version: source.version,
    className: "Special-Purpose",
    domain: "DM",
    variable: "AGE",
    label: "Age",
    definition: "The age of the subject, expressed in AGEU.",
    question: "What is the subject's age?",
    prompt: "Age",
    type: "Num",
    sdtmTarget: "AGE",
    mappingInstructions: "Maps directly to AGE.",
    codelistCode: "",
    implementationNotes: "The age value should be associated to a variable for the age unit.",
  },
  {
    version: source.version,
    className: "Special-Purpose",
    domain: "DM",
    variable: "AGEU",
    label: "Age Units",
    definition: "Units used to express age.",
    question: "What age unit was used?",
    prompt: "Age Unit",
    type: "Char",
    sdtmTarget: "AGEU",
    mappingInstructions: "Maps directly to AGEU.",
    codelistCode: "C66781",
    implementationNotes: "If age is captured, the age unit must be known.",
  },
  {
    version: source.version,
    className: "Special-Purpose",
    domain: "DM",
    variable: "SEX",
    label: "Sex",
    definition: "Sex of the subject.",
    question: "What is the sex of the subject?",
    prompt: "Sex",
    type: "Char",
    sdtmTarget: "SEX",
    mappingInstructions: "Maps directly to SEX.",
    codelistCode: "C66731",
    implementationNotes: "",
  },
];

test("returns at most two deterministic candidates and ranks exact metadata first", () => {
  const candidates = rankCdashCandidates(
    { concept_id: "age", label: "Age", purpose: "Record age", data_type: "number", coding: {} },
    rows,
  );
  assert.ok(candidates.length >= 1 && candidates.length <= 2);
  assert.equal(candidates[0].variable, "AGE");
  assert.equal(candidates[0].confidence, "high");
  assert.equal(candidates[0].companions[0].variable, "AGEU");
});

test("writes a complete mapping only after candidate selection", () => {
  const field = { concept_id: "age", label: "Age", data_type: "number", coding: {} };
  const candidate = rankCdashCandidates(field, rows)[0];
  const coding = codingFromCandidate(field, candidate, source);
  assert.equal(coding.status, "matched");
  assert.equal(coding.standard, "CDISC");
  assert.equal(coding.model, "CDASH");
  assert.equal(coding.version, "1.3");
  assert.equal(coding.domain, "DM");
  assert.equal(coding.variable, "AGE");
  assert.equal(coding.source_file, source.sourceFile);
});

test("adds companion metadata as unresolved until protocol evidence is completed", () => {
  const field = companionFieldFromCandidate(
    rows[1],
    { label: "Age", coding: { domain: "DM", variable: "AGE" } },
    source,
  );
  assert.equal(field.coding.status, "unresolved");
  assert.equal(field.coding.variable, "AGEU");
  assert.equal(field.required, "unresolved");
  assert.deepEqual(field.source_refs, []);
});
