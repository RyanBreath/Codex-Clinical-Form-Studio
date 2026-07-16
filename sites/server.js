import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

http.createServer((request, response) => {
  const requestPath = new URL(request.url, "http://localhost").pathname;
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const candidate = path.resolve(publicDirectory, relativePath);
  const isPublicFile = candidate === publicDirectory || candidate.startsWith(`${publicDirectory}${path.sep}`);
  const file = isPublicFile && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : path.join(publicDirectory, "index.html");

  fs.readFile(file, (error, contents) => {
    if (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Unable to load the eCRF application.");
      return;
    }

    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(file)] ?? "application/octet-stream",
      "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
    });
    response.end(contents);
  });
}).listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
