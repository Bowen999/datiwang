#!/usr/bin/env node
/**
 * Datiwang 生产静态服务器
 * - 服务 dist/ 构建产物（SPA 回退到 index.html）
 * - gzip 压缩、静态资源长缓存、index.html 不缓存
 * - 由 systemd 守护，开机自启、崩溃自愈
 *
 * 用法: node scripts/prod-server.mjs  (可用环境变量 PORT / HOST 覆盖)
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { createGzip } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..', 'dist');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 5173);
const INDEX = 'index.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const ASSETS_RE = /\.(?:js|css|png|jpe?g|gif|webp|svg|woff2?|ttf|ico|map)(?:\?.*)?$/i;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function safeStat(p) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  // 路径归一化，防目录穿越
  let filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let info = await safeStat(filePath);
  if (info && info.isDirectory()) {
    filePath = join(filePath, INDEX);
    info = await safeStat(filePath);
  }
  if (!info || !info.isFile()) {
    // SPA 回退
    filePath = join(ROOT, INDEX);
    info = await safeStat(filePath);
    if (!info) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
  }

  const isIndex = pathname === '/' || pathname === `/${INDEX}` || filePath.endsWith(INDEX);

  const acceptGzip = (req.headers['accept-encoding'] || '').includes('gzip');
  const useGzip = acceptGzip && info.size > 1024 && !isIndex;

  const headers = {
    'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Accept-Encoding',
    'Cache-Control': isIndex
      ? 'no-cache'
      : ASSETS_RE.test(pathname)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300',
    ...(useGzip ? { 'Content-Encoding': 'gzip' } : {}),
  };

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  if (useGzip) {
    const gz = createGzip();
    const stream = createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(gz).pipe(res);
  } else {
    res.end(await readFile(filePath));
  }

  log(`${req.method} ${pathname} -> ${info.size} bytes${acceptGzip && info.size > 1024 && !isIndex ? ' (gzip)' : ''}`);
}).listen(PORT, HOST, () => {
  log(`Datiwang production server listening on http://${HOST}:${PORT} (root: ${ROOT})`);
});