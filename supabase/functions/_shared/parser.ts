export type ParsedMovement = {
  chestName: string;
  playerName: string;
  action: "deposit" | "withdrawal";
  quantity: number;
  signedDelta: number;
  itemName: string;
  capacityKg: number | null;
};

export type ParsedMessageMovement = {
  movement: ParsedMovement;
  movementIndex: number;
  eventSuffix: string;
  rawContent: string;
};

type MessageWithEmbeds = {
  content: string;
  embeds?: Array<{ title?: string; description?: string }>;
};

const MOVEMENT_PATTERN =
  /^\s*\*\*\s*(.+?)\s*\*\*\s*\r?\n\s*\*\*\s*(.+?)\s*\*\*\s+a\s+(retiré|déposé)\s+(\d+)\s*x\s+(.+?)\s*$/iu;
const CAPACITY_PATTERN = /(\d+(?:[.,]\d+)?)\s*kg/iu;

export function parseMovement(content: string): ParsedMovement | null {
  const match = MOVEMENT_PATTERN.exec(content);
  if (!match) return null;

  const quantity = Number.parseInt(match[4], 10);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;

  const action = match[3].toLocaleLowerCase("fr") === "déposé"
    ? "deposit"
    : "withdrawal";
  const capacityMatch = CAPACITY_PATTERN.exec(match[1]);
  const capacityKg = capacityMatch
    ? Number.parseFloat(capacityMatch[1].replace(",", "."))
    : null;

  return {
    chestName: match[1].trim(),
    playerName: match[2].trim(),
    action,
    quantity,
    signedDelta: action === "deposit" ? quantity : -quantity,
    itemName: match[5].trim(),
    capacityKg,
  };
}

export function parseMessageMovements(
  message: MessageWithEmbeds,
): ParsedMessageMovement[] {
  const parsed: ParsedMessageMovement[] = [];
  const contentMovement = parseMovement(message.content);
  if (contentMovement) {
    parsed.push({
      movement: contentMovement,
      movementIndex: 0,
      eventSuffix: "",
      rawContent: message.content,
    });
  }

  for (const [embedIndex, embed] of (message.embeds ?? []).entries()) {
    if (!embed.title || !embed.description) continue;
    const normalized = `**${embed.title}**\n${embed.description}`;
    const movement = parseMovement(normalized);
    if (!movement) continue;
    parsed.push({
      movement,
      movementIndex: embedIndex + 1,
      eventSuffix: `:${embedIndex + 1}`,
      rawContent: JSON.stringify(embed),
    });
  }

  return parsed;
}
