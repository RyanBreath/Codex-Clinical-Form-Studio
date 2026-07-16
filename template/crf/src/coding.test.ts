// @vitest-environment node

import demoSchemaJson from "../../data-dictionaries/crf-schema.json";
import { buildSubmissionCoding } from "./coding";
import type { CrfContract } from "./types";

it("includes field mapping and the selected terminology code in submission metadata", () => {
  const schema = structuredClone(demoSchemaJson) as unknown as CrfContract;
  schema["x-airwayai"].fields["/biologicalSex"].coding = {
    status: "matched",
    standard: "CDISC",
    model: "SDTM",
    domain: "DM",
    variable: "SEX",
    version: "2025-03-28",
    source: "https://evs.nci.nih.gov/ftp1/CDISC/SDTM/SDTM%20Terminology.pdf",
    codelist: {
      name: "Sex",
      submissionValue: "SEX",
      ncitCode: "C66731",
      extensible: false,
    },
  };
  const unknown = schema["x-airwayai"].fields["/biologicalSex"].options?.find(
    (option) => option.value === "unknown",
  );
  if (!unknown) throw new Error("Fixture option is missing.");
  unknown.coding = {
    system: "https://ncit.nci.nih.gov",
    code: "C17998",
    submissionValue: "unknown",
  };

  expect(buildSubmissionCoding(schema, { biologicalSex: "unknown" })).toMatchObject({
    standard: "CDISC",
    fields: {
      "/biologicalSex": {
        mapping: {
          domain: "DM",
          variable: "SEX",
          codelist: { ncitCode: "C66731" },
        },
        selectedTerms: [{ code: "C17998", submissionValue: "unknown" }],
      },
    },
  });
});
