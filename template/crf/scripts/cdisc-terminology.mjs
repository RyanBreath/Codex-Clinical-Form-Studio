import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SDTM_SOURCE_URL =
  "https://evs.nci.nih.gov/ftp1/CDISC/SDTM/SDTM%20Terminology.txt";
export const SDTM_DATE_URL =
  "https://evs.nci.nih.gov/ftp1/CDISC/SDTM/SDTM%20Publication%20Date%20Stamp.txt";

const cacheDir = join(tmpdir(), "airwayai-cdisc-cache");
const cachePath = join(cacheDir, "sdtm-terminology.txt");
const cacheMetaPath = join(cacheDir, "sdtm-terminology.meta.json");
const cacheLifetimeMs = 24 * 60 * 60 * 1000;
let datasetPromise;

function normalize(value) {
  return value.toLowerCase().normalize("NFKD").replaceAll(/[^a-z0-9]+/g, " ").trim();
}

function parseVersion(dateStamp) {
  return dateStamp.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? "unknown";
}

export function parseSdtmTerminology(content, version = "unknown") {
  const [headerLine, ...lines] = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const expectedHeader = [
    "Code",
    "Codelist Code",
    "Codelist Extensible (Yes/No)",
    "Codelist Name",
    "CDISC Submission Value",
    "CDISC Synonym(s)",
    "CDISC Definition",
    "NCI Preferred Term",
  ];
  const header = headerLine?.split("\t") ?? [];
  if (expectedHeader.some((column, index) => header[index] !== column)) {
    throw new Error("NCI-EVS SDTM Terminology 欄位格式已改變，已停止解析以避免錯誤對應。");
  }

  const rawRows = lines
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter((columns) => columns.length >= 8)
    .map((columns) => ({
      code: columns[0].trim(),
      parentCode: columns[1].trim(),
      extensible: columns[2].trim() === "Yes",
      codelistName: columns[3].trim(),
      submissionValue: columns[4].trim(),
      synonyms: columns[5].trim(),
      definition: columns[6].trim(),
      preferredTerm: columns[7].trim(),
    }));
  const codelists = new Map(
    rawRows
      .filter((row) => !row.parentCode)
      .map((row) => [
        row.code,
        {
          code: row.code,
          name: row.codelistName,
          submissionValue: row.submissionValue,
          extensible: row.extensible,
        },
      ]),
  );

  return rawRows.map((row) => {
    const codelist = row.parentCode ? codelists.get(row.parentCode) : codelists.get(row.code);
    return {
      code: row.code,
      codelistCode: codelist?.code ?? row.parentCode,
      codelistName: codelist?.name ?? row.codelistName,
      codelistSubmissionValue: codelist?.submissionValue ?? "",
      codelistExtensible: codelist?.extensible ?? false,
      submissionValue: row.submissionValue,
      synonyms: row.synonyms,
      definition: row.definition,
      preferredTerm: row.preferredTerm,
      version,
      sourceUrl: SDTM_SOURCE_URL,
      isCodelist: !row.parentCode,
    };
  });
}

function scoreRow(row, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  const tokens = [...new Set(normalizedQuery.split(" ").filter((token) => token.length >= 2))];
  const exactValues = [row.code, row.submissionValue, row.codelistSubmissionValue].map(normalize);
  const preferred = normalize(row.preferredTerm);
  const searchable = normalize(
    [row.codelistName, row.submissionValue, row.synonyms, row.definition, row.preferredTerm].join(" "),
  );
  const preferredWords = new Set(preferred.split(" "));
  const searchableWords = new Set(searchable.split(" "));
  let score = 0;
  if (exactValues.includes(normalizedQuery)) score += 160;
  if (preferred === normalizedQuery) score += 120;
  if (preferred.includes(normalizedQuery)) score += 50;
  if (searchable.includes(normalizedQuery)) score += 24;
  if (tokens.length > 1 && tokens.every((token) => searchableWords.has(token))) score += 45;
  for (const token of tokens) {
    if (exactValues.some((value) => value === token)) score += 36;
    if (preferredWords.has(token)) score += 24;
    else if (preferred.includes(token)) score += 2;
    if (searchableWords.has(token)) score += 12;
    else if (searchable.includes(token)) score += 1;
  }
  if (row.isCodelist) score += 3;
  return score;
}

export function searchTerminology(rows, query, limit = 20) {
  return rows
    .map((row) => ({ ...row, score: scoreRow(row, query) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.preferredTerm.localeCompare(right.preferredTerm))
    .slice(0, Math.max(1, Math.min(limit, 50)));
}

async function fetchText(url, timeoutMs = 90_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`官方術語來源回應 ${response.status} ${response.statusText}`);
  return response.text();
}

async function readFreshCache() {
  try {
    const cacheStat = await stat(cachePath);
    if (Date.now() - cacheStat.mtimeMs > cacheLifetimeMs) return undefined;
    const [content, metaText] = await Promise.all([
      readFile(cachePath, "utf8"),
      readFile(cacheMetaPath, "utf8"),
    ]);
    const meta = JSON.parse(metaText);
    return { content, version: meta.version ?? "unknown" };
  } catch {
    return undefined;
  }
}

async function loadDatasetInternal() {
  const cached = await readFreshCache();
  if (cached) return parseSdtmTerminology(cached.content, cached.version);

  const [dateStamp, content] = await Promise.all([
    fetchText(SDTM_DATE_URL, 30_000),
    fetchText(SDTM_SOURCE_URL),
  ]);
  const version = parseVersion(dateStamp);
  await mkdir(cacheDir, { recursive: true });
  await Promise.all([
    writeFile(cachePath, content, "utf8"),
    writeFile(cacheMetaPath, JSON.stringify({ version, sourceUrl: SDTM_SOURCE_URL }), "utf8"),
  ]);
  return parseSdtmTerminology(content, version);
}

export function loadSdtmTerminology() {
  datasetPromise ??= loadDatasetInternal().catch((cause) => {
    datasetPromise = undefined;
    throw cause;
  });
  return datasetPromise;
}
