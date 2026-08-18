export type AppRole = "viewer" | "admin";

export type InventoryItem = { item_name: string; quantity: number };
export type ItemWeight = {
  item_name: string;
  weight_kg: number | null;
  updated_at: string;
};
export type ChestInventoryItem = {
  webhook_id: string | null;
  chest_name: string;
  capacity_kg: number | null;
  item_name: string;
  quantity: number;
  last_movement_at: string;
};
export type Transaction = {
  id: number;
  discord_message_id: string | null;
  discord_webhook_id: string | null;
  discord_channel_id: string | null;
  chest_name: string;
  player_name: string;
  action: "deposit" | "withdrawal" | "adjustment";
  quantity: number;
  signed_delta: number;
  item_name: string;
  discord_timestamp: string;
  source: "discord" | "manual";
  justification: string | null;
};
export type PlayerActivity = {
  player_name: string;
  deposited: number;
  withdrawn: number;
  movement_count: number;
  last_movement_at: string;
};
export type Chest = {
  webhook_id: string;
  canonical_name: string;
  detected_name: string;
  capacity_kg: number | null;
  active: boolean;
};
export type Channel = {
  channel_id: string;
  label: string;
  active: boolean;
  last_message_id: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};
export type SyncRun = {
  completed_at: string | null;
  imported: number;
  ignored: number;
  duplicates: number;
  errors: string[];
};
