import { collectDiscordMessages, type DiscordMessage } from "./discord.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const allMessages: DiscordMessage[] = Array.from(
  { length: 250 },
  (_, index) => ({
    id: String(index + 1),
    webhook_id: "500",
    content: "message",
    timestamp: new Date(index * 1000).toISOString(),
  }),
);

function historicalFetcher(input: string | URL | Request): Promise<Response> {
  const url = new URL(String(input));
  const before = url.searchParams.get("before");
  const eligible = before
    ? allMessages.filter((message) => BigInt(message.id) < BigInt(before))
    : allMessages;
  const page = eligible.slice(-100).reverse();
  return Promise.resolve(Response.json(page));
}

Deno.test("historical pagination imports more than 100 messages", async () => {
  const messages = await collectDiscordMessages(
    historicalFetcher,
    "10",
    "token",
    null,
  );
  assertEquals(messages.length, 250);
  assertEquals(messages[0].id, "1");
  assertEquals(messages.at(-1)?.id, "250");
});

Deno.test("incremental synchronization uses after and paginates", async () => {
  const requestedAfter: string[] = [];
  const incrementalFetcher = (
    input: string | URL | Request,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const after = url.searchParams.get("after")!;
    requestedAfter.push(after);
    const page = allMessages.filter((message) =>
      BigInt(message.id) > BigInt(after)
    ).slice(0, 100);
    return Promise.resolve(Response.json(page));
  };
  const messages = await collectDiscordMessages(
    incrementalFetcher,
    "10",
    "token",
    "120",
  );
  assertEquals(messages.length, 130);
  assertEquals(requestedAfter, ["120", "220"]);
  assertEquals(messages[0].id, "121");
});
