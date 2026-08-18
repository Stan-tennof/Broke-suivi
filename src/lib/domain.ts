export type StockMovement = {
  item_name: string;
  signed_delta: number;
  discord_webhook_id?: string | null;
};

export type WeightedStockLine = {
  item_name: string;
  quantity: number;
};

export type ItemWeightValue = {
  item_name: string;
  weight_kg: number | null;
};

export type ChestWeightSummary = {
  knownWeightKg: number;
  remainingKg: number | null;
  unknownItemCount: number;
  unknownUnitCount: number;
  isComplete: boolean;
};

export function globalStock(movements: StockMovement[]): Map<string, number> {
  const stock = new Map<string, number>();
  for (const movement of movements) {
    stock.set(movement.item_name, (stock.get(movement.item_name) ?? 0) + movement.signed_delta);
  }
  return stock;
}

export function chestStock(movements: StockMovement[], webhookId: string): Map<string, number> {
  return globalStock(movements.filter((movement) => movement.discord_webhook_id === webhookId));
}

export function validateAdjustment(delta: number, justification: string): string | null {
  if (!Number.isInteger(delta) || delta === 0) return "La variation doit être un entier non nul.";
  if (!justification.trim()) return "Une justification est obligatoire.";
  return null;
}

export function calculateChestWeight(
  lines: WeightedStockLine[],
  weights: ItemWeightValue[],
  capacityKg: number | null,
): ChestWeightSummary {
  const byItem = new Map(weights.map((weight) => [weight.item_name, weight.weight_kg]));
  let knownWeightKg = 0;
  let unknownItemCount = 0;
  let unknownUnitCount = 0;

  for (const line of lines) {
    const quantity = Math.max(0, Number(line.quantity));
    if (quantity === 0) continue;
    const unitWeight = byItem.get(line.item_name);
    if (unitWeight == null) {
      unknownItemCount += 1;
      unknownUnitCount += quantity;
    } else {
      knownWeightKg += quantity * Number(unitWeight);
    }
  }

  return {
    knownWeightKg,
    remainingKg: capacityKg == null ? null : capacityKg - knownWeightKg,
    unknownItemCount,
    unknownUnitCount,
    isComplete: unknownItemCount === 0,
  };
}

export function formatWeight(weightKg: number): string {
  if (Math.abs(weightKg) < 1) return `${Math.round(weightKg * 1000)} g`;
  return `${new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 3 }).format(weightKg)} kg`;
}

export function actionLabel(action: string): string {
  if (action === "deposit") return "Dépôt";
  if (action === "withdrawal") return "Retrait";
  return "Ajustement";
}
