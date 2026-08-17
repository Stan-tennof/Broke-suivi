export type StockMovement = {
  item_name: string;
  signed_delta: number;
  discord_webhook_id?: string | null;
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

export function actionLabel(action: string): string {
  if (action === "deposit") return "Dépôt";
  if (action === "withdrawal") return "Retrait";
  return "Ajustement";
}
