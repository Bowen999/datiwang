#!/usr/bin/env node
/**
 * Datiwang 生产静态服务器
 * - 服务 dist/ 构建产物（SPA 回退到 index.html）
 * - gzip 压缩、静态资源长缓存、index.html 不缓存
 * - 支持 Range（206 分段），音频不做 gzip：Safari 播放 <audio> 必须能 Range 取流
 * - 由 systemd 守护，开机自启、崩溃自愈
 *
 * 用法: node scripts/prod-server.mjs  (可用环境变量 PORT / HOST 覆盖)
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { pipeline } from 'node:stream';
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
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
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

/**
 * 解析单段 Range 头（bytes=a-b / a- / -n）。
 * 无 Range、多段、语法不合法 → null（忽略 Range，整文件 200）；起点越界 → 'unsatisfiable'（416）。
 */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (!m[1] && !m[2]) || size === 0) return null;
  let start;
  let end;
  if (!m[1]) {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (m[2] && Number(m[2]) < start) return null;
    if (start >= size) return 'unsatisfiable';
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return { start, end };
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

  const mime = MIME[extname(filePath)] || 'application/octet-stream';
  const range = isIndex ? null : parseRange(req.headers.range, info.size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
    return;
  }

  // 带 Range 的请求要按原始字节切片，不能压缩；音频本身已压缩，gzip 没收益
  const acceptGzip = (req.headers['accept-encoding'] || '').includes('gzip');
  const useGzip = acceptGzip && info.size > 1024 && !isIndex && !range && !mime.startsWith('audio/');

  const headers = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Accept-Encoding',
    'Cache-Control': isIndex
      ? 'no-cache'
      : ASSETS_RE.test(pathname)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300',
    ...(useGzip
      ? { 'Content-Encoding': 'gzip' }
      : {
          'Content-Length': range ? range.end - range.start + 1 : info.size,
          ...(isIndex ? {} : { 'Accept-Ranges': 'bytes' }),
          ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${info.size}` } : {}),
        }),
  };

  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  // pipeline 会在客户端中途断开（Safari 常这样）时销毁文件流，避免泄漏文件句柄
  const stream = createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
  if (useGzip) pipeline(stream, createGzip(), res, () => {});
  else pipeline(stream, res, () => {});

  log(`${req.method} ${pathname} -> ${range ? `206 ${range.start}-${range.end}/${info.size}` : `${info.size} bytes`}${useGzip ? ' (gzip)' : ''}`);
}).listen(PORT, HOST, () => {
  log(`Datiwang production server listening on http://${HOST}:${PORT} (root: ${ROOT})`);
});