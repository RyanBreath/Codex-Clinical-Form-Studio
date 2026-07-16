import { RENDERER_VERSION } from "./renderer-version";
import type { CrfContract, FormSubmission } from "./types";

export interface DownloadTraceability {
  traceabilityVersion: "1.0.0";
  projectId: string;
  prj_id: string;
  protocolFileName?: string;
  protocolSha256?: string;
  formId: string;
  schemaVersion: string;
  contractVersion: string;
  schemaComment: string;
}

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

export function extractDownloadTraceability(schema: CrfContract): DownloadTraceability | undefined {
  const schemaComment = typeof schema.$comment === "string" ? schema.$comment : undefined;
  if (!schemaComment) return undefined;

  const values = Object.fromEntries(
    schemaComment.split(";").map((entry) => {
      const [key, ...rest] = entry.trim().split("=");
      return [key, rest.join("=").trim()];
    }),
  );
  const projectId = values.projectId;
  if (!projectId) return undefined;

  return {
    traceabilityVersion: "1.0.0",
    projectId,
    prj_id: projectId,
    ...(values.protocol ? { protocolFileName: values.protocol } : {}),
    ...(values.protocolSha256 ? { protocolSha256: values.protocolSha256 } : {}),
    formId: schema["x-airwayai"].formId,
    schemaVersion: schema["x-airwayai"].schemaVersion,
    contractVersion: schema["x-airwayai"].contractVersion,
    schemaComment,
  };
}

export function downloadSubmissionArtifacts(schema: CrfContract, submission: FormSubmission): void {
  const downloadedAt = new Date().toISOString();
  const fileStem = `${submission.formId}-${submission.schemaVersion}-${timestampForFileName(downloadedAt)}`;
  const traceability = extractDownloadTraceability(schema);

  downloadJson(`${fileStem}-form.json`, {
    artifactType: "crf-schema",
    downloadedAt,
    rendererVersion: RENDERER_VERSION,
    ...(traceability ? { traceability } : {}),
    schema,
  });
  downloadJson(`${fileStem}-answers.json`, {
    artifactType: "crf-answers",
    downloadedAt,
    rendererVersion: RENDERER_VERSION,
    ...(traceability ? { traceability } : {}),
    submission,
  });
}
