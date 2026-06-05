import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./api/router.mjs";
import { createNodeExecutionContext, createRuntimeEnv } from "./runtime-env.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = resolve(process.env.STATIC_DIR || join(root, "dist"));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const env = createRuntimeEnv();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function requestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  return req;
}

function nodeRequestToWeb(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const hostHeader = req.headers.host || `localhost:${port}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return new Request(`${proto}://${hostHeader}${req.url}`, {
    method: req.method,
    headers,
    body: requestBody(req),
    duplex: "half"
  });
}

async function writeWebResponse(res, webResponse) {
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));
  if (!webResponse.body) {
    res.end();
    return;
  }
  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((resolveWrite) => res.once("drain", resolveWrite));
    }
    res.end();
  } catch (error) {
    res.destroy(error);
  }
}

function staticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = normalize(decoded === "/" ? "/index.html" : decoded).replace(/^([/\\])+/, "");
  const file = resolve(distDir, relative);
  if (file !== distDir && !file.startsWith(`${distDir}${sep}`)) return null;
  if (existsSync(file) && statSync(file).isFile()) return file;
  if (extname(file)) return null;
  return resolve(distDir, "index.html");
}

function serveStatic(req, res) {
  const file = staticPath(req.url || "/");
  if (!file || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": contentTypes[extname(file)] || "application/octet-stream",
    "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable"
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || "/", "http://local").pathname;
    if (pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (pathname.startsWith("/api")) {
      const response = await handleApiRequest(nodeRequestToWeb(req), env, createNodeExecutionContext());
      await writeWebResponse(res, response);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    console.error("Node server error:", error?.stack || error);
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "SERVER_ERROR", message: "server error" } }));
  }
});

server.listen(port, host, () => {
  console.log(`taskcheck server listening on http://${host}:${port}`);
});
