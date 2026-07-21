const STOP_WORDS = new Set([
  "a",
  "all",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "collected",
  "current",
  "did",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "protocol",
  "subject",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "with",
]);

export const CDASH_SOURCE_URL =
  "https://www.cdisc.org/standards/foundational/cdash/cdash-model-v1-3";

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
  );
}

function intersection(left, right) {
  return [...left].filter((token) => right.has(token));
}

function fieldTypeMatches(fieldType, candidate) {
  const type = normalize(candidate.type);
  if (["integer", "number"].includes(fieldType)) return type === "num";
  if (fieldType === "boolean") {
    return type === "char" && candidate.codelistCode === "C66742";
  }
  if (fieldType === "date") return type === "char";
  return fieldType === "string" ? type === "char" : true;
}

function concreteVariable(candidate, preferredDomain) {
  if (!candidate.variable.includes("--")) return candidate.variable;
  return preferredDomain
    ? candidate.variable.replace("--", preferredDomain.toUpperCase())
    : candidate.variable;
}

function companionRows(candidate, rows) {
  const evidence = [
    candidate.definition,
    candidate.mappingInstructions,
    candidate.implementationNotes,
  ].join(" ");
  if (!/(must|should|associated|requires?|necessary|needed|meaningful)/i.test(evidence)) {
    return [];
  }

  return rows
    .filter((row) => {
      if (!row.variable || row.variable === candidate.variable) return false;
      if (candidate.domain && row.domain && candidate.domain !== row.domain) return false;
      const escaped = row.variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^A-Z0-9-])${escaped}([^A-Z0-9-]|$)`).test(evidence);
    })
    .slice(0, 2)
    .map((row) => ({
      domain: row.domain,
      variable: row.variable,
      label: row.label,
      type: row.type,
      codelistCode: row.codelistCode,
      definition: row.definition,
      question: row.question,
      prompt: row.prompt,
      sdtmTarget: row.sdtmTarget,
      mappingInstructions: row.mappingInstructions,
      implementationNotes: row.implementationNotes,
    }));
}

/**
 * Rank metadata-table rows by deterministic text and type relevance.
 * Results are review candidates only and never constitute an approved mapping.
 */
export function rankCdashCandidates(field, rows, limit = 2) {
  const label = normalize(field.label);
  const concept = normalize(field.concept_id);
  const query = [field.label, field.concept_id, field.purpose].filter(Boolean).join(" ");
  const queryTokens = tokens(query);
  const preferredDomain = String(field.coding?.domain ?? "").toUpperCase();

  return rows
    .map((row) => {
      const variable = normalize(row.variable);
      const variableLabel = normalize(row.label);
      const labelTokens = tokens(row.label);
      const promptTokens = tokens(row.prompt);
      const questionTokens = tokens(row.question);
      const definitionTokens = tokens(row.definition);
      const labelHits = intersection(queryTokens, labelTokens);
      const promptHits = intersection(queryTokens, promptTokens);
      const questionHits = intersection(queryTokens, questionTokens);
      const definitionHits = intersection(queryTokens, definitionTokens);
      const matchedAttributes = [];
      let score = 0;

      if (label && label === variableLabel) {
        score += 72;
        matchedAttributes.push("exact variable label");
      }
      if (concept && (concept === variable || concept.replace(/ /g, "") === variable)) {
        score += 68;
        matchedAttributes.push("exact variable code");
      }
      if (label && label.length >= 4 && variableLabel.includes(label)) {
        score += 28;
        matchedAttributes.push("variable label phrase");
      }
      if (labelHits.length) {
        score += labelHits.length * 14;
        matchedAttributes.push("variable label tokens");
      }
      if (promptHits.length) {
        score += promptHits.length * 9;
        matchedAttributes.push("prompt tokens");
      }
      if (questionHits.length) {
        score += questionHits.length * 7;
        matchedAttributes.push("question text tokens");
      }
      if (definitionHits.length) {
        score += definitionHits.length * 3;
        matchedAttributes.push("definition tokens");
      }
      if (preferredDomain && preferredDomain === row.domain) {
        score += 10;
        matchedAttributes.push("existing domain");
      }
      const typeMatch = fieldTypeMatches(String(field.data_type ?? ""), row);
      score += typeMatch ? 7 : -12;

      const differences = [];
      if (!typeMatch) {
        differences.push(
          `Field data type ${field.data_type ?? "unresolved"} differs from CDASH ${row.type || "unspecified"}.`,
        );
      }
      if (!row.domain && !preferredDomain) {
        differences.push("This is a class-level variable template; a CDASH domain is still required.");
      }
      if (row.variable.includes("--") && !preferredDomain) {
        differences.push("The -- placeholder cannot be resolved until a domain is selected.");
      }

      return {
        ...row,
        resolvedVariable: concreteVariable(row, row.domain || preferredDomain),
        score,
        confidence: score >= 70 ? "high" : score >= 38 ? "medium" : "low",
        matchedAttributes: [...new Set(matchedAttributes)],
        differences,
        companions: companionRows(row, rows),
      };
    })
    .filter((candidate) => candidate.score >= 22)
    .sort((left, right) => right.score - left.score || left.variable.localeCompare(right.variable))
    .slice(0, Math.max(1, Math.min(2, limit)));
}

export function codingFromCandidate(field, candidate, sourceMeta) {
  const domain = candidate.domain || String(field.coding?.domain ?? "").toUpperCase();
  const variable = concreteVariable(candidate, domain);
  const complete = Boolean(domain && variable && !variable.includes("--"));
  const confidence = Math.max(1, Math.min(100, candidate.score));
  return {
    ...field.coding,
    status: complete ? "matched" : "unresolved",
    rationale: `Reviewer selected ${domain ? `${domain}.` : ""}${variable} from ${sourceMeta.version}; matched on ${candidate.matchedAttributes.join(", ") || "metadata text"}.`,
    standard: "CDISC",
    model: "CDASH",
    implementation_guide: "CDASH Model",
    version: "1.3",
    domain: domain || undefined,
    variable,
    variable_label: candidate.label,
    source_url: sourceMeta.sourceUrl,
    source_file: sourceMeta.sourceFile,
    source_retrieved_at: sourceMeta.retrievedAt,
    mapping_confidence_percent: confidence,
    question_text: candidate.question || undefined,
    prompt: candidate.prompt || undefined,
    sdtm_target: candidate.sdtmTarget || undefined,
    mapping_instructions: candidate.mappingInstructions || undefined,
    implementation_notes: candidate.implementationNotes || undefined,
    codelist: candidate.codelistCode
      ? {
          name: candidate.label,
          submission_value: candidate.variable,
          ncit_code: candidate.codelistCode,
          extensible: false,
        }
      : undefined,
  };
}

export function companionFieldFromCandidate(companion, sourceField, sourceMeta) {
  const domain = companion.domain || sourceField.coding?.domain || "";
  const variable = concreteVariable(companion, domain);
  return {
    concept_id: variable.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
    label: companion.label,
    purpose: `Companion field suggested by ${sourceMeta.version} metadata for ${sourceField.label}.`,
    data_type: normalize(companion.type) === "num" ? "number" : "string",
    required: "unresolved",
    source_refs: [],
    notes: [
      `Reviewer-added unresolved companion candidate from ${sourceMeta.sourceFile}; protocol support, source locator, and requiredness must be reviewed.`,
    ],
    coding: {
      status: "unresolved",
      rationale: `Companion candidate referenced by the selected ${sourceField.coding?.variable ?? "CDASH"} metadata; specialist review required.`,
      standard: "CDISC",
      model: "CDASH",
      implementation_guide: "CDASH Model",
      version: "1.3",
      domain: domain || undefined,
      variable,
      variable_label: companion.label,
      source_url: sourceMeta.sourceUrl,
      source_file: sourceMeta.sourceFile,
      source_retrieved_at: sourceMeta.retrievedAt,
      question_text: companion.question || undefined,
      prompt: companion.prompt || undefined,
      sdtm_target: companion.sdtmTarget || undefined,
      mapping_instructions: companion.mappingInstructions || undefined,
      implementation_notes: companion.implementationNotes || undefined,
    },
  };
}
