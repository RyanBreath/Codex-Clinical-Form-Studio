import assert from "node:assert/strict";
import test from "node:test";
import { parseSdtmTerminology, searchTerminology } from "./cdisc-terminology.mjs";

const fixture = [
  "Code\tCodelist Code\tCodelist Extensible (Yes/No)\tCodelist Name\tCDISC Submission Value\tCDISC Synonym(s)\tCDISC Definition\tNCI Preferred Term",
  "C66731\t\tNo\tSex\tSEX\tSex\tA terminology codelist for sex.\tCDISC Sex Terminology",
  "C16576\tC66731\t\tSex\tF\tFemale\tA person who belongs to the sex that produces ova.\tFemale",
  "C20197\tC66731\t\tSex\tM\tMale\tA person who belongs to the sex that produces sperm.\tMale",
].join("\n");

test("parses codelist parent metadata into each SDTM term", () => {
  const rows = parseSdtmTerminology(fixture, "2026-03-27");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], {
    code: "C16576",
    codelistCode: "C66731",
    codelistName: "Sex",
    codelistSubmissionValue: "SEX",
    codelistExtensible: false,
    submissionValue: "F",
    synonyms: "Female",
    definition: "A person who belongs to the sex that produces ova.",
    preferredTerm: "Female",
    version: "2026-03-27",
    sourceUrl: "https://evs.nci.nih.gov/ftp1/CDISC/SDTM/SDTM%20Terminology.txt",
    isCodelist: false,
  });
});

test("ranks exact submission values and relevant preferred terms", () => {
  const rows = parseSdtmTerminology(fixture, "2026-03-27");
  assert.equal(searchTerminology(rows, "Female")[0].code, "C16576");
  assert.equal(searchTerminology(rows, "SEX")[0].code, "C66731");
});

test("fails closed when the official tabular contract changes", () => {
  assert.throws(
    () => parseSdtmTerminology("Unexpected\tHeader\nA\tB"),
    /欄位格式已改變/,
  );
});
