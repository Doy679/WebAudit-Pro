import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
const types: Record<string, string> = { ".html": "text/html", ".xml": "application/xml", ".txt": "text/plain" };

/** Serves test/fixtures/site with {{origin}} replaced. Records every requested path and method. */
export async function startFixtureServer() {
  const requests: { method: string; path: string }[] = [];
  // Flip `state.fixed` to simulate a developer fixing the overflow between two audits.
  const state = { fixed: false };
  const server: Server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    requests.push({ method: req.method ?? "GET", path });
    const file = path === "/" ? "index.html" : path.slice(1);
    try {
      let body = (await readFile(join(root, file), "utf8")).replaceAll("{{origin}}", origin);
      if (state.fixed) body = body.replace('<div class="wide" id="wide-box"></div>', "");
      res.writeHead(200, { "content-type": types[extname(file)] ?? "text/plain" }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html" }).end("<!doctype html><title>Not found</title><h1>404</h1>");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const origin = `http://127.0.0.1:${port}`;
  return { origin, requests, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}
