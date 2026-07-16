// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { downloadSubmissionArtifacts } from "./downloads";
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
  } satisfies FormSubmission;

  downloadSubmissionArtifacts(schema, submission);

  expect(createObjectURL).toHaveBeenCalledTimes(2);
  expect(click).toHaveBeenCalledTimes(2);
  expect(revokeObjectURL).toHaveBeenCalledTimes(2);
});
