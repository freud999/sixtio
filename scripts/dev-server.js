// Minimal local stand-in for Vercel: serves static files from the repo root
// and routes /api/<name> to the handlers in /api, with res.status/json helpers.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 5173);

// Load .env (no dependency on dotenv).
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice('/api/'.length).replace(/[^a-zA-Z0-9_-]/g, '');
    const file = join(ROOT, 'api', `${name}.js`);
    if (!name || !existsSync(file)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      req.body = raw ? JSON.parse(raw) : {};
    } catch {
      req.body = {};
    }
    res.status = (code) => ((res.statusCode = code), res);
    res.json = (obj) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    try {
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Dev server error' }));
    }
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  let file = resolve(ROOT, rel);
  if (!extname(file) && existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(ROOT + sep) || !existsSync(file)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  res.end(await readFile(file));
});

server.listen(PORT, () => {
  console.log(`Sixtio dev server: http://localhost:${PORT}`);
  if (process.env.ALLOW_FAKE_AUTH === '1') {
    console.log('ALLOW_FAKE_AUTH=1 — requests without Telegram initData use a stub user.');
  }
});
