import { parseMessageMovements, parseMovement } from "./parser.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("parses an accented deposit with spaces", () => {
  const parsed = parseMovement(
    "  ** Coffre 500kg cotés garage **\n ** Stan Broke **   a déposé 39x Fertilisant enrichi ",
  );
  assert(parsed, "Expected a parsed movement");
  assert(parsed.action === "deposit", "Expected deposit");
  assert(parsed.playerName === "Stan Broke", "Expected player name");
  assert(
    parsed.itemName === "Fertilisant enrichi",
    "Expected item with spaces",
  );
  assert(parsed.capacityKg === 500, "Expected capacity");
  assert(parsed.signedDelta === 39, "Expected positive delta");
});

Deno.test("parses an accented withdrawal and special item", () => {
  const parsed = parseMovement(
    "**Coffre côté dépôt**\r\n**Émile Du Pont** a retiré 12x Pièce d'arme + rare",
  );
  assert(parsed, "Expected a parsed movement");
  assert(parsed.action === "withdrawal", "Expected withdrawal");
  assert(parsed.signedDelta === -12, "Expected negative delta");
});

Deno.test("ignores invalid messages", () => {
  assert(
    parseMovement("Bonjour tout le monde") === null,
    "Invalid message should be ignored",
  );
  assert(
    parseMovement("**Coffre**\n**Joueur** a déposé 0x Item") === null,
    "Zero should be ignored",
  );
});

Deno.test("parses every movement from Discord embeds", () => {
  const parsed = parseMessageMovements({
    content: "",
    embeds: [
      {
        title: "Coffre Plantation",
        description: "**Léo Broke** a déposé 43x Fertilisant",
      },
      {
        title: "Coffre Plantation",
        description: "**Stan Broke** a retiré 32x Bouteille d'eau",
      },
    ],
  });
  assert(parsed.length === 2, "Expected two embedded movements");
  assert(
    parsed[0].movement.chestName === "Coffre Plantation",
    "Expected embed title as chest",
  );
  assert(
    parsed[1].movement.itemName === "Bouteille d'eau",
    "Expected embedded item",
  );
  assert(parsed[1].eventSuffix === ":2", "Expected stable embed event suffix");
});
