import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const cleanPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, cleanPath === "/" ? "index.html" : cleanPath);
  try {
    const bytes = await readFile(filePath);
    response.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
    response.end(bytes);
  } catch {
    const bytes = await readFile(join(root, "index.html"));
    response.writeHead(200, { "content-type": types[".html"] });
    response.end(bytes);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Static preview running at http://127.0.0.1:${port}`);
});
