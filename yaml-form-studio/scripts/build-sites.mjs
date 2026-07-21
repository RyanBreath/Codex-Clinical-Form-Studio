import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { build } from "vite";

const originalRoot = process.cwd();
const requiresAsciiWorkaround = process.platform === "win32" && /[^\x00-\x7F]/.test(originalRoot);
let temporaryRoot;

function parseCsv(text) {
  const records = [];
  let record = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\n") {
      record.push(value.replace(/\r$/, ""));
      records.push(record);
      record = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (value || record.length) {
    record.push(value.replace(/\r$/, ""));
    records.push(record);
  }
  const [headers, ...rows] = records;
  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

async function listFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await visit(root);
  return output.sort();
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function runBuild(projectRoot, csvPath) {
  const dist = resolve(projectRoot, "dist");
  await rm(dist, { recursive: true, force: true });
  await build({ root: projectRoot, configFile: resolve(projectRoot, "vite.config.ts") });

  const csvInfo = await stat(csvPath);
  const rows = parseCsv(await readFile(csvPath, "utf8")).map((row) => ({
    version: row.Version,
    className: row.Class,
    domain: row.Domain,
    variable: row["CDASH Variable"],
    label: row["CDASH Variable Label"],
    definition: row["DRAFT CDASH Definition"],
    domainSpecific: row["Domain Specific"],
    question: row["Question Text"],
    prompt: row.Prompt,
    type: row.Type,
    sdtmTarget: row["SDTM Target"],
    mappingInstructions: row["Mapping Instructions"],
    codelistCode: row["Controlled Terminology Codelist Code"],
    implementationNotes: row["Implementation Notes"],
  }));
  if (rows.length !== 314 || rows.some((row) => row.version !== "CDASH Model v1.3")) {
    throw new Error("CDASH_Model_v1.3.csv did not match the expected 314-row CDASH Model v1.3 export.");
  }
  const dataset = {
    source: {
      version: "CDASH Model v1.3",
      sourceFile: "Docs/CDASH_Model_v1.3.csv",
      sourceUrl: "https://www.cdisc.org/standards/foundational/cdash/cdash-model-v1-3",
      retrievedAt: csvInfo.mtime.toISOString(),
      rowCount: rows.length,
    },
    rows,
  };
  await writeFile(
    resolve(dist, "client/cdash-model-v1.3.json"),
    `${JSON.stringify(dataset)}\n`,
    "utf8",
  );

  await build({
    root: projectRoot,
    configFile: false,
    publicDir: false,
    build: {
      ssr: resolve(projectRoot, "worker/index.ts"),
      outDir: resolve(dist, "server"),
      emptyOutDir: true,
      minify: true,
      rollupOptions: { output: { entryFileNames: "index.js", format: "es" } },
    },
    ssr: { noExternal: true },
  });

  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  const clientFiles = await listFiles(resolve(dist, "client"));
  const assets = await Promise.all(
    clientFiles.map(async (path) => ({
      path: relative(dist, path).replaceAll("\\", "/"),
      bytes: (await stat(path)).size,
      sha256: await sha256(path),
    })),
  );
  const manifest = {
    application: "AirwayAI eCRF Studio",
    version: packageJson.version,
    renderingMode: "precompiled-static-react",
    entrypoint: "client/index.html",
    cdashSource: dataset.source,
    assets,
  };
  const manifestPath = resolve(dist, "asset-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const checksumFiles = [
    ...clientFiles,
    resolve(dist, "server/index.js"),
    resolve(dist, ".openai/hosting.json"),
    manifestPath,
  ];
  const checksums = await Promise.all(
    checksumFiles.map(async (path) => `${await sha256(path)}  ${relative(dist, path).replaceAll("\\", "/")}`),
  );
  await writeFile(resolve(dist, "checksums.sha256"), `${checksums.sort().join("\n")}\n`, "utf8");
}

try {
  if (!requiresAsciiWorkaround) {
    await runBuild(originalRoot, resolve(originalRoot, "../Docs/CDASH_Model_v1.3.csv"));
  } else {
    temporaryRoot = await mkdtemp(join(tmpdir(), "airwayai-static-sites-"));
    const junction = join(temporaryRoot, "site");
    await symlink(resolve(originalRoot), junction, "junction");
    await runBuild(junction, resolve(originalRoot, "../Docs/CDASH_Model_v1.3.csv"));
  }
} finally {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}
