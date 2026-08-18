import { describe, expect, it } from "vitest";
import { calculateChestWeight, chestStock, formatMoney, formatWeight, globalStock, isMoneyItem, validateAdjustment } from "./domain";

const movements = [
  { item_name: "Fer", signed_delta: 10, discord_webhook_id: "1" },
  { item_name: "Fer", signed_delta: -3, discord_webhook_id: "1" },
  { item_name: "Fer", signed_delta: 5, discord_webhook_id: "2" },
  { item_name: "Bois rare", signed_delta: 4, discord_webhook_id: "2" },
];

describe("stock calculations", () => {
  it("calculates global stock", () => {
    expect(Object.fromEntries(globalStock(movements))).toEqual({ Fer: 12, "Bois rare": 4 });
  });

  it("calculates stock by chest", () => {
    expect(Object.fromEntries(chestStock(movements, "1"))).toEqual({ Fer: 7 });
  });
});

describe("manual adjustments", () => {
  it("requires a non-zero integer and a reason", () => {
    expect(validateAdjustment(0, "Stock initial")).not.toBeNull();
    expect(validateAdjustment(5, "")).not.toBeNull();
    expect(validateAdjustment(-5, "Correction inventaire")).toBeNull();
  });
});

describe("chest weights", () => {
  it("calculates known weight and exact remaining capacity", () => {
    const result = calculateChestWeight(
      [{ item_name: "Fer", quantity: 10 }, { item_name: "Bois", quantity: 4 }],
      [{ item_name: "Fer", weight_kg: 0.5 }, { item_name: "Bois", weight_kg: 2 }],
      20,
    );
    expect(result).toEqual({
      knownWeightKg: 13,
      remainingKg: 7,
      unknownItemCount: 0,
      unknownUnitCount: 0,
      isComplete: true,
    });
  });

  it("marks capacity as partial when an item weight is missing", () => {
    const result = calculateChestWeight(
      [{ item_name: "Fer", quantity: 10 }, { item_name: "Mystère", quantity: 3 }],
      [{ item_name: "Fer", weight_kg: 0.5 }],
      20,
    );
    expect(result.knownWeightKg).toBe(5);
    expect(result.remainingKg).toBe(15);
    expect(result.unknownItemCount).toBe(1);
    expect(result.unknownUnitCount).toBe(3);
    expect(result.isComplete).toBe(false);
  });

  it("excludes clean and dirty money from chest weight", () => {
    const result = calculateChestWeight(
      [{ item_name: "Argent", quantity: 5000 }, { item_name: "Argent Sale", quantity: 3000 }],
      [],
      500,
    );
    expect(result.knownWeightKg).toBe(0);
    expect(result.unknownItemCount).toBe(0);
    expect(result.remainingKg).toBe(500);
  });

  it("formats grams and kilograms", () => {
    expect(formatWeight(0.25)).toBe("250 g");
    expect(formatWeight(1.5)).toBe("1,5 kg");
  });
});

describe("money items", () => {
  it("recognizes money labels without case sensitivity", () => {
    expect(isMoneyItem("Argent")).toBe(true);
    expect(isMoneyItem("ARGENT SALE")).toBe(true);
    expect(isMoneyItem("Fertilisant")).toBe(false);
  });

  it("formats dollar amounts", () => {
    expect(formatMoney(1234)).toMatch(/1[\s  ]?234/);
  });
});
