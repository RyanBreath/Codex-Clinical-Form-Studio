import type { CrfContract } from "../types";

// Derive a new identity without changing the imported source or an existing version.
export function contractForNewVersion(source: CrfContract, name: string): CrfContract {
  const version = name.trim();
  if (version.length > 60 || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version))
    throw new Error("請以主版.次版.修訂版填寫版本，例如 2.0.0。");
  const result = structuredClone(source);
  result["x-airwayai"].schemaVersion = version;
  const oldSuffix = `/${source["x-airwayai"].formId}/${source["x-airwayai"].schemaVersion}`;
  const prefix = source.$id.endsWith(oldSuffix) ? source.$id.slice(0, -oldSuffix.length) : "https://airwayai.example/forms";
  result.$id = `${prefix}/${result["x-airwayai"].formId}/${version}`;
  return result;
}
