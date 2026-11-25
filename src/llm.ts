import { readFileSync } from 'node:fs';
import type { Turn } from './memory.ts';

export type Part =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

// Personality lives in prompts/system.md so it can be edited without touching code; restart to apply.
const SYSTEM = readFileSync(new URL('../prompts/system.md', import.meta.url), 'utf8');

export async function ask(history: Turn[], parts: Part[], profile = ''): Promise<string> {
  const { OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL } = process.env;
  const body = JSON.stringify({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      ...(profile ? [{ role: 'system', content: profile }] : []),
      ...history.flatMap((t) => [{ role: 'user', content: t.user }, { role: 'assistant', content: t.reply }]),
      { role: 'user', content: parts },
    ],
  });
  const call = () => fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_API_KEY}` },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  let res = await call();
  // One retry on rate limit / upstream hiccup.
  if (res.status === 429 || res.status >= 500) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await call();
  }
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = (await res.json() as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('LLM returned no content');
  return text;
}
