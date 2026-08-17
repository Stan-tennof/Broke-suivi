import { describe, expect, it } from "vitest";
import { chestStock, globalStock, validateAdjustment } from "./domain";

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
