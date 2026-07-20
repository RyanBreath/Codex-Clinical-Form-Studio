import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { loadSdtmTerminology, searchTerminology } from "./cdisc-terminology.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const production = process.argv.includes("--production");
const port = Number.parseInt(process.env.AIRWAYAI_STUDIO_PORT ?? "4174", 10);
const host = "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("AIRWAYAI_STUDIO_PORT 必須是有效的 TCP port。");
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function handleApi(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "airwayai-ecrf-studio" });
    return true;
  }
  if (url.pathname !== "/api/cdisc/search") return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method-not-allowed" });
    return true;
  }
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length < 2 || query.length > 200) {
    sendJson(response, 400, { error: "query-length", message: "查詢文字需為 2–200 個字元。" });
    return true;
  }
  try {
    const rows = await loadSdtmTerminology();
    const results = searchTerminology(rows, query, 20);
    sendJson(response, 200, {
      query,
      count: results.length,
      version: rows[0]?.version ?? "unknown",
      sourceUrl: rows[0]?.sourceUrl,
      results,
    });
  } catch (cause) {
    sendJson(response, 502, {
      error: "terminology-source-unavailable",
      message: cause instanceof Error ? cause.message : "無法讀取 NCI-EVS 官方術語來源。",
    });
  }
  return true;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function serveStatic(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  const requestedPath = url.pathname === "/" ? "/studio.html" : decodeURIComponent(url.pathname);
  const distRoot = resolve(root, "dist-studio");
  const filePath = resolve(distRoot, `.${requestedPath}`);
  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("找不到檔案；請先執行 npm run studio:build。");
  }
}

const vite = production
  ? undefined
  : await createViteServer({
      root,
      configFile: resolve(root, "vite.studio.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });

const server = createServer(async (request, response) => {
  if (await handleApi(request, response)) return;
  if (vite) {
    vite.middlewares(request, response, () => {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });
    return;
  }
  await serveStatic(request, response);
});

server.listen(port, host, () => {
  console.log(`AirwayAI eCRF Studio: http://${host}:${port}/studio.html`);
  console.log("首次 CDISC 查詢會下載並快取官方 NCI-EVS SDTM CT（約 13 MB）。");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await vite?.close();
    server.close(() => process.exit(0));
  });
}
