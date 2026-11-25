import { mkdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import whatsapp from 'whatsapp-web.js';
import type { Message } from 'whatsapp-web.js';
import { ask } from './llm.ts';
import type { Part } from './llm.ts';
import type { createAllowlist } from './groups.ts';
import type { createMemory } from './memory.ts';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript))/;

export function createBot(dataDir: string, allow: ReturnType<typeof createAllowlist>, memory: ReturnType<typeof createMemory>) {
  mkdirSync(join(dataDir, 'auth'), { recursive: true });
  // A pod restarted on the same volume leaves Chromium lock files that block launch.
  const sessionDir = join(dataDir, 'auth', 'session-primary');
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) rmSync(join(sessionDir, f), { force: true });
  const client = new whatsapp.Client({
    authStrategy: new whatsapp.LocalAuth({ clientId: 'primary', dataPath: join(dataDir, 'auth') }),
    puppeteer: {
      headless: process.env.CHROMIUM_HEADLESS_SHELL === 'true' ? 'shell' : true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      // shortcut: no Chromium sandbox, relies on container isolation; upgrade if run bare on a shared host.
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    },
  });
  const status = { state: 'starting' as string, qr: null as string | null };
  let readyRecovery: NodeJS.Timeout | undefined;
  let recovering = false;
  let busy = false;
  const queues = new Map<string, Promise<unknown>>();

  client.on('qr', (qr) => { status.state = 'pairing'; status.qr = qr; });
  client.on('ready', () => { status.state = 'connected'; status.qr = null; clearInterval(readyRecovery); });
  client.on('disconnected', (reason) => {
    if (status.state === 'unlinking') return;
    status.state = `disconnected: ${reason}`;
    status.qr = null;
    clearInterval(readyRecovery);
    console.error('whatsapp disconnected', reason);
  });
  client.on('auth_failure', () => { status.state = 'auth_failure'; });

  // Private chats: phone-number ids and LIDs. Anything else (status, broadcast, channels) is ignored.
  const isDm = (msg: Message) => msg.from.endsWith('@c.us') || msg.from.endsWith('@lid');
  const recent = new Map<string, number[]>();
  // shortcut: in-memory per-chat flood guard (10 msgs/min); upgrade to a shared limiter if you run several replicas.
  const flooded = (id: string) => {
    const now = Date.now();
    const hits = (recent.get(id) ?? []).filter((t) => now - t < 60_000);
    hits.push(now);
    recent.set(id, hits);
    return hits.length > 10;
  };

  async function isAddressed(msg: Message): Promise<boolean> {
    if (isDm(msg)) return true;
    // Contact.isMe covers both phone-number and LID mentions.
    if (msg.mentionedIds.length && (await msg.getMentions()).some((c) => c.isMe)) return true;
    if (!msg.hasQuotedMsg) return false;
    return (await msg.getQuotedMessage()).fromMe;
  }

  async function buildParts(msg: Message): Promise<{ parts: Part[]; label: string } | null> {
    // getContact can throw for LID chats; the name is cosmetic, so never let it block a reply.
    const sender = (await msg.getContact().then((c) => c.pushname, () => undefined)) || (msg as { _data?: { notifyName?: string } })._data?.notifyName || (msg.author ?? msg.from).split('@')[0];
    const text = msg.body.replace(/@\d+/g, '').trim();
    const parts: Part[] = [];
    let label = text;
    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      if (media && Buffer.byteLength(media.data, 'base64') > MAX_FILE_BYTES) parts.push({ type: 'text', text: '[attachment too large, ignored]' });
      else if (media?.mimetype.startsWith('image/')) {
        parts.push({ type: 'image_url', image_url: { url: `data:${media.mimetype};base64,${media.data}` } });
        label = `[${msg.type === 'sticker' ? 'sticker' : 'image'}] ${text}`;
      } else if (media && TEXT_TYPES.test(media.mimetype)) {
        parts.push({ type: 'text', text: `File ${media.filename ?? 'document'}:\n${Buffer.from(media.data, 'base64').toString('utf8').slice(0, 100_000)}` });
        label = `[file ${media.filename ?? ''}] ${text}`;
      } else if (media?.mimetype === 'application/pdf') {
        const filename = media.filename ?? 'document.pdf';
        parts.push({ type: 'file', file: { filename, file_data: `data:application/pdf;base64,${media.data}` } });
        label = `[pdf ${filename}] ${text}`;
      } else parts.push({ type: 'text', text: `[unsupported attachment: ${media?.mimetype ?? msg.type}]` });
    }
    const mentionOnly = !text && msg.mentionedIds.length > 0;
    if (!parts.length && !text && !mentionOnly) return null;
    const messageText = text || (mentionOnly ? '(tagged you)' : '(no text)');
    parts.unshift({ type: 'text', text: `${sender}: ${messageText}` });
    return { parts, label: `${sender}: ${label || messageText}` };
  }

  async function handle(msg: Message) {
    try {
      const built = await buildParts(msg);
      if (!built) return;
      const reply = await ask(memory.get(msg.from), built.parts);
      await msg.reply(reply);
      memory.add(msg.from, { user: built.label, reply });
    } catch (err) {
      console.error('reply failed', err);
      await msg.reply('Something broke on my side man, try again in a bit.').catch((e) => console.error('error reply failed', e));
    }
  }

  client.on('message', async (msg) => {
    try {
      console.log(`incoming from=${msg.from} type=${msg.type} hasMedia=${msg.hasMedia}`);
      const inAllowedGroup = msg.from.endsWith('@g.us') && allow.has(msg.from);
      if (!inAllowedGroup && !(isDm(msg) && process.env.ALLOW_DM === 'true')) return;
      if (!(await isAddressed(msg)) || flooded(msg.from)) return;
      // Serialize per group so memory order matches conversation order.
      const next = (queues.get(msg.from) ?? Promise.resolve()).then(() => handle(msg)).catch((e) => console.error(e));
      queues.set(msg.from, next);
    } catch (err) { console.error('message handler failed', err); }
  });

  function connect(): boolean {
    if (busy || !['starting', 'disconnected', 'error', 'auth_failure'].includes(status.state.split(':')[0])) return false;
    const previous = status.state;
    busy = true;
    status.state = 'connecting';
    status.qr = null;
    void (async () => {
      if (previous !== 'starting') await client.destroy();
      Reflect.deleteProperty(client, 'info');
      await client.initialize();
      if (status.state === 'connected') return;
      // WhatsApp can sync during the /login/ to / navigation before wwebjs catches the ready event.
      readyRecovery = setInterval(async () => {
        if (recovering || status.state !== 'pairing' || client.info || !client.pupPage) return;
        recovering = true;
        try {
          await client.pupPage.evaluate(async () => {
            const page = window as unknown as {
              require: (name: string) => { Socket?: { hasSynced?: boolean } } | null;
              WWebJS?: unknown;
              onAppStateHasSyncedEvent?: () => Promise<void>;
            };
            if (page.require('WAWebSocketModel')?.Socket?.hasSynced && page.WWebJS) {
              await page.onAppStateHasSyncedEvent?.();
            }
          });
        } catch (err) { console.error('ready recovery failed', err); }
        finally { recovering = false; }
      }, 5000);
    })().catch((err) => { status.state = 'error'; console.error('whatsapp init failed', err); })
      .finally(() => { busy = false; });
    return true;
  }

  function disconnect(): boolean {
    if (busy || status.state === 'disconnecting' || status.state === 'disconnected') return false;
    busy = true;
    status.state = 'disconnecting';
    status.qr = null;
    clearInterval(readyRecovery);
    void client.destroy().then(() => { status.state = 'disconnected'; })
      .catch((err) => { status.state = 'error'; console.error('whatsapp disconnect failed', err); })
      .finally(() => { busy = false; });
    return true;
  }

  function unlink(): boolean {
    if (busy || status.state === 'unlinking') return false;
    busy = true;
    status.state = 'unlinking';
    status.qr = null;
    clearInterval(readyRecovery);
    void (async () => {
      try {
        if (client.pupBrowser?.isConnected()) await client.logout();
      } catch (err) { console.error('WhatsApp remote logout failed; clearing local pairing', err); }
      await client.destroy();
      await rm(sessionDir, { recursive: true, force: true });
      allow.clear();
      memory.clearAll();
      queues.clear();
      status.state = 'disconnected';
      busy = false;
      connect();
    })().catch((err) => { status.state = 'error'; busy = false; console.error('WhatsApp unlink failed', err); });
    return true;
  }

  return {
    status,
    start: connect,
    connect,
    disconnect,
    unlink,
    stop: () => { clearInterval(readyRecovery); return client.destroy(); },
    async groups() {
      const chats = await client.getChats();
      return chats.filter((c) => c.isGroup).map((c) => ({ id: c.id._serialized, name: c.name, enabled: allow.has(c.id._serialized) }));
    },
  };
}
