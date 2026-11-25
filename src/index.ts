import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import QRCode from 'qrcode';
import swaggerUi from 'swagger-ui-dist';
import { createAllowlist } from './groups.ts';
import { createMemory } from './memory.ts';
import { openapi } from './openapi.ts';
import { createBot } from './wa.ts';

const { ADMIN_USER, ADMIN_PASS, OPENAI_BASE_URL, OPENAI_MODEL, DATA_DIR = './data', PORT = '8000' } = process.env;
if (!ADMIN_USER || !ADMIN_PASS || !OPENAI_BASE_URL || !OPENAI_MODEL) throw new Error('ADMIN_USER, ADMIN_PASS, OPENAI_BASE_URL and OPENAI_MODEL are required');

const sha = (s: string) => createHash('sha256').update(s).digest();
const expected = sha(`Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64')}`);
const authorized = (req: IncomingMessage) => timingSafeEqual(sha(req.headers.authorization ?? ''), expected);

const read = (name: string) => readFileSync(new URL(name, import.meta.url));
const swaggerDir = swaggerUi.getAbsoluteFSPath();
const files: Record<string, readonly [string, Buffer]> = {
  '/': ['text/html; charset=utf-8', read('./ui.html')],
  '/ui.js': ['text/javascript', read('./ui.js')],
  '/openapi.json': ['application/json', Buffer.from(JSON.stringify(openapi))],
  '/docs': ['text/html; charset=utf-8', Buffer.from('<!doctype html><meta charset="utf-8"><title>Bot Liar API</title><link rel="stylesheet" href="/docs/swagger-ui.css"><div id="ui"></div><script src="/docs/swagger-ui-bundle.js"></script><script src="/docs/init.js"></script>')],
  '/docs/init.js': ['text/javascript', Buffer.from("SwaggerUIBundle({ url: '/openapi.json', dom_id: '#ui' });")],
  '/docs/swagger-ui.css': ['text/css', readFileSync(join(swaggerDir, 'swagger-ui.css'))],
  '/docs/swagger-ui-bundle.js': ['text/javascript', readFileSync(join(swaggerDir, 'swagger-ui-bundle.js'))],
};

// shortcut: per-socket-IP lockout; behind a shared proxy IP it is global. Upgrade to X-Forwarded-For if the ingress is trusted.
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILS = 10;
const LOCK_MS = 15 * 60_000;
const allow = createAllowlist(join(DATA_DIR, 'groups.json'));
const bot = createBot(DATA_DIR, allow, createMemory());

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};
const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { ok: true });
    const ip = req.socket.remoteAddress ?? 'unknown';
    const fail = failures.get(ip);
    const locked = fail && fail.until > Date.now();
    if (locked && fail.count >= MAX_FAILS) return json(res, 429, { error: 'too many failed attempts' });
    if (!authorized(req)) {
      failures.set(ip, { count: (locked ? fail.count : 0) + 1, until: Date.now() + LOCK_MS });
      res.writeHead(401, { 'www-authenticate': 'Basic realm="bot-liar"' }).end();
      return;
    }
    failures.delete(ip);
    const url = new URL(req.url ?? '/', 'http://x');
    const file = req.method === 'GET' ? files[url.pathname] : undefined;
    if (file) {
      res.writeHead(200, { 'content-type': file[0] }).end(file[1]);
    } else if (req.method === 'GET' && url.pathname === '/api/status') {
      json(res, 200, { state: bot.status.state, qr: bot.status.qr ? await QRCode.toDataURL(bot.status.qr) : null });
    } else if (req.method === 'POST' && url.pathname === '/api/connect') {
      json(res, bot.connect() ? 202 : 409, { state: bot.status.state });
    } else if (req.method === 'POST' && url.pathname === '/api/disconnect') {
      json(res, bot.disconnect() ? 202 : 409, { state: bot.status.state });
    } else if (req.method === 'POST' && url.pathname === '/api/unlink') {
      json(res, bot.unlink() ? 202 : 409, { state: bot.status.state });
    } else if (req.method === 'GET' && url.pathname === '/api/groups') {
      if (bot.status.state !== 'connected') return json(res, 409, { error: 'WhatsApp not connected' });
      json(res, 200, await bot.groups());
    } else if (req.method === 'PUT' && url.pathname.startsWith('/api/groups/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/groups/'.length));
      const enabled = url.searchParams.get('enabled');
      if (!/^[\w-]+@g\.us$/.test(id) || (enabled !== 'true' && enabled !== 'false')) return json(res, 422, { error: 'invalid group id or enabled value' });
      allow.set(id, enabled === 'true');
      json(res, 200, { id, enabled: allow.has(id) });
    } else json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: 'internal error' });
  }
});
// Slowloris guard.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

server.listen(Number(PORT), '0.0.0.0');
bot.start();
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); bot.stop().finally(() => process.exit(0)); });
