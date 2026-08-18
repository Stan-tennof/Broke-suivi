export type DiscordMessage = {
  id: string;
  webhook_id?: string | null;
  content: string;
  timestamp: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    fields?: Array<{ name: string; value: string }>;
  }>;
};

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const DISCORD_API = "https://discord.com/api/v10";
const PAGE_SIZE = 100;

function compareSnowflakes(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

async function fetchPage(
  fetcher: FetchLike,
  channelId: string,
  token: string,
  cursorName?: "after" | "before",
  cursor?: string,
): Promise<DiscordMessage[]> {
  const url = new URL(`${DISCORD_API}/channels/${channelId}/messages`);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (cursorName && cursor) url.searchParams.set(cursorName, cursor);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetcher(url, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (response.ok) return await response.json() as DiscordMessage[];

    if (response.status === 429 && attempt < 3) {
      const body = await response.json().catch(() => ({ retry_after: 1 }));
      const waitMs = Math.ceil(Number(body.retry_after ?? 1) * 1000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    throw new Error(`Discord API ${response.status}: ${await response.text()}`);
  }
  throw new Error("Discord rate limit retry budget exhausted");
}

export async function collectDiscordMessages(
  fetcher: FetchLike,
  channelId: string,
  token: string,
  after: string | null,
): Promise<DiscordMessage[]> {
  const messages = new Map<string, DiscordMessage>();

  if (after) {
    let cursor = after;
    while (true) {
      const page = await fetchPage(fetcher, channelId, token, "after", cursor);
      for (const message of page) messages.set(message.id, message);
      if (page.length < PAGE_SIZE) break;
      const nextCursor = page.map((message) => message.id).sort(
        compareSnowflakes,
      ).at(-1)!;
      if (nextCursor === cursor) {
        throw new Error("Discord incremental pagination did not advance");
      }
      cursor = nextCursor;
    }
  } else {
    let cursor: string | undefined;
    while (true) {
      const page = await fetchPage(
        fetcher,
        channelId,
        token,
        cursor ? "before" : undefined,
        cursor,
      );
      for (const message of page) messages.set(message.id, message);
      if (page.length < PAGE_SIZE) break;
      const nextCursor = page.map((message) =>
        message.id
      ).sort(compareSnowflakes)[0];
      if (nextCursor === cursor) {
        throw new Error("Discord historical pagination did not advance");
      }
      cursor = nextCursor;
    }
  }

  return [...messages.values()].sort((a, b) => compareSnowflakes(a.id, b.id));
}

export function newestMessageId(messages: DiscordMessage[]): string | null {
  if (messages.length === 0) return null;
  return messages.map((message) => message.id).sort(compareSnowflakes).at(-1)!;
}
