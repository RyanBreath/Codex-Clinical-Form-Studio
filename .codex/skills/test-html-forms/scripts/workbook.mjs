import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "./qa-core.mjs";

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
if (!["create", "results"].includes(command)) {
  throw new Error(
    "Usage: workbook.mjs create --spec ... --cases ... --output ... --preview-dir ... | results --input ... --cases ... --results ... --output ... --preview-dir ...",
  );
}

const requireFromWorkingDirectory = createRequire(path.join(process.cwd(), "package.json"));
const { FileBlob, SpreadsheetFile, Workbook } = requireFromWorkingDirectory("@oai/artifact-tool");

const COLORS = {
  navy: "#17324D",
  teal: "#0F766E",
  paleTeal: "#DFF4F1",
  paleBlue: "#E8F1FA",
  paleGold: "#FFF4D6",
  line: "#CCD6E0",
  text: "#1F2937",
  muted: "#64748B",
  white: "#FFFFFF",
  pass: "#DCFCE7",
  fail: "#FEE2E2",
  manual: "#FEF3C7",
  technical: "#EDE9FE",
};

function columnName(index) {
  let current = index + 1;
  let result = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function cleanXmlText(value) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

function excelLocalDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return cleanXmlText(value);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
}

function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return cleanXmlText(value.join("; "));
  if (typeof value === "object") return cleanXmlText(JSON.stringify(value));
  if (typeof value === "string") return cleanXmlText(value);
  return value;
}

function formulaCountIf(forms, columnByForm, criteria) {
  const criteriaList = Array.isArray(criteria) ? criteria : [criteria];
  const parts = forms
    .flatMap((form) => {
      const column = columnByForm(form);
      if (!column || form.cases.length === 0) return [];
      return criteriaList.map(
        (criterion) =>
          `COUNTIF('${form.form.sheetName}'!$${column}$2:$${column}$${form.cases.length + 1},"${criterion}")`,
      );
    })
    .filter(Boolean);
  if (!parts.length) return "=0";
  if (parts.length === 1) return `=${parts[0]}`;
  return `=SUM(${parts.join(",")})`;
}

function styleTitle(sheet, width) {
  const range = sheet.getRange(`A1:${columnName(width - 1)}1`);
  range.merge();
  range.values = [["HTML 表單 QA 測試報告"]];
  range.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white, size: 16 },
    verticalAlignment: "center",
    horizontalAlignment: "left",
  };
  range.format.rowHeight = 32;
}

function styleHeader(range) {
  range.format = {
    fill: COLORS.teal,
    font: { bold: true, color: COLORS.white },
    verticalAlignment: "center",
    horizontalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: COLORS.line },
  };
  range.format.rowHeight = 32;
}

function styleDataRange(range) {
  range.format = {
    font: { color: COLORS.text },
    verticalAlignment: "top",
    wrapText: true,
    borders: {
      insideHorizontal: { style: "thin", color: "#E5EAF0" },
      bottom: { style: "thin", color: COLORS.line },
    },
  };
}

function createSummarySheet(workbook, spec, cases) {
  const sheet = workbook.worksheets.getItem("測試摘要");
  sheet.showGridLines = false;
  styleTitle(sheet, 6);

  const metadata = [
    ["項目", "內容"],
    ["prj_id", spec.prjId || ""],
    ["來源", spec.source?.value || spec.url || ""],
    ["頁面標題", spec.title || ""],
    ["HTML SHA-256", spec.sha256 || ""],
    ["產生時間", excelLocalDate(spec.runStartedAt || cases.generatedAt || "")],
    ["表單數", cases.totals.forms],
    ["欄位數", cases.totals.fields],
    ["測試案例數", cases.totals.cases],
    ["跳過／裁減紀錄數", cases.totals.skipped],
    ["正式送出", spec.allowSubmit ? "已授權" : "未授權，只驗證送出前狀態"],
  ];
  sheet.getRange(`A3:B${metadata.length + 2}`).values = metadata;
  styleHeader(sheet.getRange("A3:B3"));
  styleDataRange(sheet.getRange(`A4:B${metadata.length + 2}`));
  sheet.getRange("B8").format.numberFormat = "yyyy-mm-dd hh:mm:ss";

  const categories = [
    "合法基準",
    "必填",
    "格式",
    "邊界值",
    "長度",
    "步進值",
    "條件式欄位",
    "唯讀或停用",
    "布林抽樣",
    "Pairwise",
    "Unicode",
    "前後空白",
    "推測規則",
  ];
  const categoryStart = 3;
  sheet.getRange(`D${categoryStart}:E${categoryStart}`).values = [["測試類型", "案例數"]];
  styleHeader(sheet.getRange(`D${categoryStart}:E${categoryStart}`));
  sheet.getRange(`D${categoryStart + 1}:D${categoryStart + categories.length}`).values =
    categories.map((category) => [category]);
  sheet.getRange(`E${categoryStart + 1}:E${categoryStart + categories.length}`).formulas =
    categories.map((category) => [
      formulaCountIf(cases.forms, () => "B", category),
    ]);
  styleDataRange(
    sheet.getRange(`D${categoryStart + 1}:E${categoryStart + categories.length}`),
  );

  const samplingRows = [["表單", "布林欄位總數", "已抽樣", "未抽樣"]];
  for (const form of cases.forms) {
    samplingRows.push([
      form.form.label,
      form.booleanSampling.total,
      form.booleanSampling.sampled.join(", "),
      form.booleanSampling.omitted.join(", "),
    ]);
  }
  const samplingStart = metadata.length + 5;
  sheet.getRange(`A${samplingStart}:D${samplingStart + samplingRows.length - 1}`).values =
    samplingRows;
  styleHeader(sheet.getRange(`A${samplingStart}:D${samplingStart}`));
  if (samplingRows.length > 1) {
    styleDataRange(
      sheet.getRange(`A${samplingStart + 1}:D${samplingStart + samplingRows.length - 1}`),
    );
  }

  const skipStart = samplingStart + samplingRows.length + 2;
  const skipRows = [["表單", "欄位／案例", "跳過或裁減原因"]];
  for (const skipped of cases.skipped) {
    skipRows.push([
      skipped.form || "",
      skipped.field || skipped.case || "",
      skipped.reason || "",
    ]);
  }
  sheet.getRange(`A${skipStart}:C${skipStart + skipRows.length - 1}`).values = skipRows;
  styleHeader(sheet.getRange(`A${skipStart}:C${skipStart}`));
  if (skipRows.length > 1) {
    styleDataRange(sheet.getRange(`A${skipStart + 1}:C${skipStart + skipRows.length - 1}`));
  }

  sheet.freezePanes.freezeRows(1);
  sheet.getRange("A:A").format.columnWidth = 18;
  sheet.getRange("B:B").format.columnWidth = 48;
  sheet.getRange("C:C").format.columnWidth = 54;
  sheet.getRange("D:D").format.columnWidth = 24;
  sheet.getRange("E:E").format.columnWidth = 14;
  sheet.getRange("F:F").format.columnWidth = 4;
  sheet.getUsedRange().format.autofitRows();
  return sheet;
}

function createCaseSheets(workbook, cases) {
  for (const form of cases.forms) {
    const sheet = workbook.worksheets.getItem(form.form.sheetName);
    sheet.showGridLines = false;
    const headers = [
      "案例編號",
      "測試類型",
      "測試說明",
      ...form.fields.map((field) => field.column),
      "預期測試結果",
    ];
    const rows = form.cases.map((testCase) => [
      testCase.id,
      testCase.testType,
      testCase.description,
      ...form.fields.map((field) => cellValue(testCase.values[field.key])),
      testCase.expected.result,
    ]);
    sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
    styleHeader(sheet.getRangeByIndexes(0, 0, 1, headers.length));
    if (rows.length) {
      sheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;
      styleDataRange(sheet.getRangeByIndexes(1, 0, rows.length, headers.length));
      sheet.getRangeByIndexes(1, headers.length - 1, rows.length, 1).format.fill =
        COLORS.paleBlue;
    }
    sheet.freezePanes.freezeRows(1);
    sheet.freezePanes.freezeColumns(3);
    sheet.getRange("A:A").format.columnWidth = 15;
    sheet.getRange("B:B").format.columnWidth = 16;
    sheet.getRange("C:C").format.columnWidth = 38;
    for (let index = 3; index < headers.length - 1; index += 1) {
      sheet.getRange(`${columnName(index)}:${columnName(index)}`).format.columnWidth = 20;
    }
    sheet
      .getRange(`${columnName(headers.length - 1)}:${columnName(headers.length - 1)}`)
      .format.columnWidth = 42;
    sheet.getUsedRange().format.autofitRows();
  }
}

async function addExecutionResults(workbook, cases, execution) {
  const resultMap = new Map((execution.results || []).map((result) => [result.id, result]));
  for (const form of cases.forms) {
    const sheet = workbook.worksheets.getItem(form.form.sheetName);
    const baseColumnCount = 3 + form.fields.length + 1;
    const appendedHeaders = [
      "實際測試結果",
      "PASS/FAIL/需人工確認",
      "錯誤或備註",
      "截圖檔名",
      "測試時間",
    ];
    sheet.getRangeByIndexes(0, baseColumnCount, 1, appendedHeaders.length).values = [
      appendedHeaders,
    ];
    styleHeader(sheet.getRangeByIndexes(0, baseColumnCount, 1, appendedHeaders.length));
    if (form.cases.length) {
      const resultRows = form.cases.map((testCase) => {
        const result = resultMap.get(testCase.id) || {
          status: "技術錯誤",
          actualResult: "找不到執行結果。",
          note: "execution-log.json 缺少此案例。",
          screenshotFiles: [],
          testedAt: "",
        };
        return [
          cellValue(result.actualResult || ""),
          cellValue(result.status || "技術錯誤"),
          cellValue(result.note || ""),
          cellValue((result.screenshotFiles || []).join("; ")),
          excelLocalDate(result.testedAt || ""),
        ];
      });
      sheet
        .getRangeByIndexes(1, baseColumnCount, resultRows.length, appendedHeaders.length)
        .values = resultRows;
      styleDataRange(
        sheet.getRangeByIndexes(1, baseColumnCount, resultRows.length, appendedHeaders.length),
      );
      const statusRange = sheet.getRangeByIndexes(1, baseColumnCount + 1, resultRows.length, 1);
      sheet
        .getRangeByIndexes(1, baseColumnCount + 4, resultRows.length, 1)
        .format.numberFormat = "yyyy-mm-dd hh:mm:ss";
      statusRange.conditionalFormats.add("containsText", {
        text: "PASS",
        format: { fill: COLORS.pass, font: { color: "#166534", bold: true } },
      });
      statusRange.conditionalFormats.add("containsText", {
        text: "FAIL",
        format: { fill: COLORS.fail, font: { color: "#991B1B", bold: true } },
      });
      statusRange.conditionalFormats.add("containsText", {
        text: "需人工確認",
        format: { fill: COLORS.manual, font: { color: "#92400E", bold: true } },
      });
      statusRange.conditionalFormats.add("containsText", {
        text: "技術錯誤",
        format: { fill: COLORS.technical, font: { color: "#5B21B6", bold: true } },
      });
      statusRange.conditionalFormats.add("containsText", {
        text: "TECHNICAL_ERROR",
        format: { fill: COLORS.technical, font: { color: "#5B21B6", bold: true } },
      });
    }
    sheet.getRange(`${columnName(baseColumnCount)}:${columnName(baseColumnCount)}`).format.columnWidth =
      42;
    sheet
      .getRange(`${columnName(baseColumnCount + 1)}:${columnName(baseColumnCount + 1)}`)
      .format.columnWidth = 22;
    sheet
      .getRange(`${columnName(baseColumnCount + 2)}:${columnName(baseColumnCount + 2)}`)
      .format.columnWidth = 34;
    sheet
      .getRange(`${columnName(baseColumnCount + 3)}:${columnName(baseColumnCount + 3)}`)
      .format.columnWidth = 34;
    sheet
      .getRange(`${columnName(baseColumnCount + 4)}:${columnName(baseColumnCount + 4)}`)
      .format.columnWidth = 24;
    sheet.getUsedRange().format.autofitRows();
  }

  const summary = workbook.worksheets.getItem("測試摘要");
  summary.getRange("G3:H3").values = [["執行狀態", "案例數"]];
  styleHeader(summary.getRange("G3:H3"));
  const statuses = [
    { label: "PASS", criteria: "PASS" },
    { label: "FAIL", criteria: "FAIL" },
    { label: "需人工確認", criteria: "需人工確認" },
    { label: "技術錯誤", criteria: ["技術錯誤", "TECHNICAL_ERROR"] },
  ];
  summary.getRange("G4:G7").values = statuses.map((status) => [status.label]);
  summary.getRange("H4:H7").formulas = statuses.map((status) => [
    formulaCountIf(
      cases.forms,
      (form) => columnName(3 + form.fields.length + 2),
      status.criteria,
    ),
  ]);
  styleDataRange(summary.getRange("G4:H7"));
  summary.getRange("G:G").format.columnWidth = 22;
  summary.getRange("H:H").format.columnWidth = 14;
}

async function verifyAndExport(workbook, outputPath, previewDir, mode, cases) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });
  const verification = { mode, sheets: [], formulaErrors: null };

  for (const sheet of workbook.worksheets.items) {
    const used = sheet.getUsedRange();
    const preview = await workbook.render({
      sheetName: sheet.name,
      autoCrop: "all",
      scale: 1,
      format: "png",
    });
    const previewPath = path.join(
      previewDir,
      `${mode}-${sheet.name.replace(/[<>:"/\\|?*]/g, "_")}.png`,
    );
    await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
    const inspect = await workbook.inspect({
      kind: "table",
      sheetId: sheet.name,
      range: `A1:${columnName(Math.min(11, used.columnCount - 1))}${Math.min(
        20,
        used.rowCount,
      )}`,
      include: "values,formulas",
      tableMaxRows: 20,
      tableMaxCols: 12,
      maxChars: 5000,
    });
    verification.sheets.push({
      name: sheet.name,
      rows: used.rowCount,
      columns: used.columnCount,
      preview: previewPath,
      inspect: inspect.ndjson,
    });
  }

  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 300 },
    summary: "final formula error scan",
    maxChars: 5000,
  });
  verification.formulaErrors = errors.ndjson;
  verification.caseCount = cases.totals.cases;
  await fs.writeFile(
    path.join(previewDir, `${mode}-verification.json`),
    `${JSON.stringify(verification, null, 2)}\n`,
    "utf8",
  );

  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
}

if (command === "create") {
  if (!args.spec || !args.cases || !args.output || !args["preview-dir"]) {
    throw new Error("Missing create arguments.");
  }
  const spec = JSON.parse(await fs.readFile(path.resolve(args.spec), "utf8"));
  const cases = JSON.parse(await fs.readFile(path.resolve(args.cases), "utf8"));
  const workbook = Workbook.create();
  workbook.worksheets.add("測試摘要");
  for (const form of cases.forms) {
    workbook.worksheets.add(form.form.sheetName);
  }
  createSummarySheet(workbook, spec, cases);
  createCaseSheets(workbook, cases);
  await verifyAndExport(
    workbook,
    path.resolve(args.output),
    path.resolve(args["preview-dir"]),
    "test-data",
    cases,
  );
  console.log(JSON.stringify({ output: path.resolve(args.output), cases: cases.totals.cases }));
}

if (command === "results") {
  if (!args.input || !args.cases || !args.results || !args.output || !args["preview-dir"]) {
    throw new Error("Missing results arguments.");
  }
  const input = await FileBlob.load(path.resolve(args.input));
  const workbook = await SpreadsheetFile.importXlsx(input);
  const cases = JSON.parse(await fs.readFile(path.resolve(args.cases), "utf8"));
  const execution = JSON.parse(await fs.readFile(path.resolve(args.results), "utf8"));
  await addExecutionResults(workbook, cases, execution);
  await verifyAndExport(
    workbook,
    path.resolve(args.output),
    path.resolve(args["preview-dir"]),
    "test-results",
    cases,
  );
  console.log(JSON.stringify({ output: path.resolve(args.output), results: execution.results?.length || 0 }));
}
