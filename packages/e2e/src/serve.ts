import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export interface StaticServer {
  url: string;
  close: () => Promise<void>;
}

export async function serveStatic(dir: string, port = 4173): Promise<StaticServer> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      let filePath = path.join(dir, decodeURIComponent(url.pathname));
      if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
      if (!existsSync(filePath)) {
        // SPA-ish fallback to the requested .html
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const body = await readFile(filePath);
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      res.end(body);
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  });
  await new Promise<void>(resolve => server.listen(port, resolve));
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
