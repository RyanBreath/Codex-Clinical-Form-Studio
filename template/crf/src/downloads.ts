import { RENDERER_VERSION } from "./renderer-version";
import type { CrfContract, FormSubmission } from "./types";

function timestampForFileName(isoTimestamp: string): string {
  return isoTimestamp.replaceAll(":", "-").replaceAll(".", "-");
}

function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadSubmissionArtifacts(schema: CrfContract, submission: FormSubmission): void {
  const downloadedAt = new Date().toISOString();
  const fileStem = `${submission.formId}-${submission.schemaVersion}-${timestampForFileName(downloadedAt)}`;

  downloadJson(`${fileStem}-form.json`, {
    artifactType: "crf-schema",
    downloadedAt,
    rendererVersion: RENDERER_VERSION,
    schema,
  });
  downloadJson(`${fileStem}-answers.json`, {
    artifactType: "crf-answers",
    downloadedAt,
    rendererVersion: RENDERER_VERSION,
    submission,
  });
}
