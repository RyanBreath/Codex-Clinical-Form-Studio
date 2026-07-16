// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { downloadSubmissionArtifacts, extractDownloadTraceability } from "./downloads";
import type { CrfContract, FormSubmission } from "./types";

const createObjectURL = vi.fn(() => "blob:download");
const revokeObjectURL = vi.fn();
const click = vi.fn();

Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, writable: true });
Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, writable: true });
vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);

afterEach(() => vi.clearAllMocks());

it("downloads schema and answers after a successful submission", () => {
  const schema = { "x-airwayai": {} } as CrfContract;
  const submission = {
    formId: "screening-and-baseline-psg",
    schemaVersion: "0.1.0",
    contractVersion: "1.0.0",
    rendererVersion: "0.1.0",
    locale: "zh-TW",
    data: { age: 42 },
    derivedPaths: [],
    coding: { standard: "CDISC", fields: {} },
  } satisfies FormSubmission;

  downloadSubmissionArtifacts(schema, submission);

  expect(createObjectURL).toHaveBeenCalledTimes(2);
  expect(click).toHaveBeenCalledTimes(2);
  expect(revokeObjectURL).toHaveBeenCalledTimes(2);
});

it("extracts the immutable project ID from the schema comment for download traceability", () => {
  const schema = {
    $comment:
      "projectId=prj_20260716-1253; protocol=Prot_000 (1).pdf; protocolSha256=abc123",
    "x-airwayai": {
      formId: "osahs-gastroenteroscopy-screening-procedure",
      schemaVersion: "0.1.0",
      contractVersion: "1.0.0",
    },
  } as unknown as CrfContract;

  expect(extractDownloadTraceability(schema)).toMatchObject({
    projectId: "prj_20260716-1253",
    prj_id: "prj_20260716-1253",
    protocolFileName: "Prot_000 (1).pdf",
  });
});
