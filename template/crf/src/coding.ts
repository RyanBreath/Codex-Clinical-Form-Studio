import { getAtPointer, hasAtPointer } from "./pointer";
import type {
  CrfContract,
  FieldCoding,
  JsonRecord,
  SubmissionCoding,
  TerminologyCode,
} from "./types";

function optionCodesForValue(
  value: unknown,
  options: Array<{ value: unknown; coding?: TerminologyCode }> | undefined,
): TerminologyCode[] | undefined {
  if (!options) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const selected = values.flatMap((selectedValue) => {
    const option = options.find((candidate) => Object.is(candidate.value, selectedValue));
    return option?.coding ? [structuredClone(option.coding)] : [];
  });
  return selected.length > 0 ? selected : undefined;
}

export function buildSubmissionCoding(
  contract: CrfContract,
  activeData: JsonRecord,
): SubmissionCoding {
  const fields: SubmissionCoding["fields"] = {};

  for (const [path, config] of Object.entries(contract["x-airwayai"].fields)) {
    if (!config.coding || !hasAtPointer(activeData, path)) continue;
    const value = getAtPointer(activeData, path);
    const selectedTerms = optionCodesForValue(value, config.options);
    fields[path] = {
      mapping: structuredClone(config.coding as FieldCoding),
      ...(selectedTerms ? { selectedTerms } : {}),
    };
  }

  return { standard: "CDISC", fields };
}
