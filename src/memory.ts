export const MAX_TURNS = 30;
export const MAX_GROUPS = 100;
// ~4 chars per token. A stored turn is capped at 512 tokens: 128 for the user, 384 for the reply.
const USER_CHARS = 128 * 4;
const REPLY_CHARS = 384 * 4;

export interface Turn { user: string; reply: string }

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function createMemory() {
  const turns = new Map<string, Turn[]>();
  return {
    get: (groupId: string): Turn[] => turns.get(groupId) ?? [],
    add(groupId: string, turn: Turn) {
      const list = [...(turns.get(groupId) ?? []), { user: clip(turn.user, USER_CHARS), reply: clip(turn.reply, REPLY_CHARS) }];
      turns.delete(groupId);
      turns.set(groupId, list.slice(-MAX_TURNS));
      if (turns.size > MAX_GROUPS) turns.delete(turns.keys().next().value!);
    },
    clear: (groupId: string) => turns.delete(groupId),
    clearAll: () => turns.clear(),
  };
}
