import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { corsHeaders } from "../_shared/cors.ts";
import { collectDiscordMessages, newestMessageId } from "../_shared/discord.ts";
import { parseMessageMovements } from "../_shared/parser.ts";

type SyncResult = {
  inspected: number;
  imported: number;
  duplicates: number;
  ignored: number;
  errors: string[];
  synchronizedAt: string;
  diagnosticSamples?: Array<{
    messageId: string;
    webhookId: string | null;
    content: string;
    embeds: unknown[];
  }>;
};

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const discordToken = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!supabaseUrl || !serviceKey || !discordToken) {
    return json(request, { error: "Server configuration is incomplete" }, 500);
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCron = Boolean(cronSecret) &&
    request.headers.get("x-cron-secret") === cronSecret;
  let requesterId: string | null = null;

  if (!isCron) {
    const bearer = request.headers.get("authorization")?.replace(
      /^Bearer\s+/i,
      "",
    );
    if (!bearer) {
      return json(request, { error: "Authentication required" }, 401);
    }
    const { data: authData, error: authError } = await db.auth.getUser(bearer);
    const email = authData.user?.email?.toLowerCase();
    if (authError || !authData.user || !email) {
      return json(request, { error: "Invalid session" }, 401);
    }
    const { data: access } = await db.from("app_users").select("role, active")
      .eq("email", email).maybeSingle();
    if (!access?.active || access.role !== "admin") {
      return json(request, { error: "Admin access required" }, 403);
    }
    requesterId = authData.user.id;
  }

  const body = await request.json().catch(() => ({})) as {
    mode?: string;
    channelId?: string;
    diagnostic?: boolean;
  };
  const historical = body.mode === "historical";
  const triggerType = historical ? "historical" : isCron ? "cron" : "manual";
  const result: SyncResult = {
    inspected: 0,
    imported: 0,
    duplicates: 0,
    ignored: 0,
    errors: [],
    synchronizedAt: new Date().toISOString(),
  };
  if (body.diagnostic) result.diagnosticSamples = [];

  const { data: run, error: runError } = await db.from("sync_runs").insert({
    trigger_type: triggerType,
    requested_by: requesterId,
  }).select("id").single();
  if (runError) return json(request, { error: runError.message }, 500);

  let channelQuery = db.from("discord_channels").select(
    "channel_id, last_message_id, initial_sync_completed",
  ).eq("active", true);
  if (body.channelId) {
    channelQuery = channelQuery.eq("channel_id", body.channelId);
  }
  const { data: channels, error: channelError } = await channelQuery;
  if (channelError) result.errors.push(channelError.message);

  const { data: chestRows } = await db.from("webhook_chests").select(
    "webhook_id, active",
  );
  const webhookActivity = new Map(
    (chestRows ?? []).map((row) => [row.webhook_id, row.active]),
  );

  for (const channel of channels ?? []) {
    try {
      const incrementalAfter = historical || !channel.initial_sync_completed
        ? null
        : channel.last_message_id;
      const messages = await collectDiscordMessages(
        fetch,
        channel.channel_id,
        discordToken,
        incrementalAfter,
      );
      result.inspected += messages.length;

      for (const message of messages) {
        if (
          !message.webhook_id ||
          webhookActivity.get(message.webhook_id) === false
        ) {
          result.ignored += 1;
          if (body.diagnostic && result.diagnosticSamples!.length < 5) {
            result.diagnosticSamples!.push({
              messageId: message.id,
              webhookId: message.webhook_id ?? null,
              content: message.content,
              embeds: message.embeds ?? [],
            });
          }
          continue;
        }
        const parsedMovements = parseMessageMovements(message);
        if (parsedMovements.length === 0) {
          result.ignored += 1;
          if (body.diagnostic && result.diagnosticSamples!.length < 5) {
            result.diagnosticSamples!.push({
              messageId: message.id,
              webhookId: message.webhook_id,
              content: message.content,
              embeds: message.embeds ?? [],
            });
          }
          continue;
        }

        for (const parsed of parsedMovements) {
          const movement = parsed.movement;
          const { data: inserted, error } = await db.rpc(
            "ingest_discord_transaction",
            {
              p_message_id: message.id,
              p_event_key: `${message.id}${parsed.eventSuffix}`,
              p_movement_index: parsed.movementIndex,
              p_webhook_id: message.webhook_id,
              p_channel_id: channel.channel_id,
              p_chest_name: movement.chestName,
              p_capacity_kg: movement.capacityKg,
              p_player_name: movement.playerName,
              p_action: movement.action,
              p_quantity: movement.quantity,
              p_item_name: movement.itemName,
              p_discord_timestamp: message.timestamp,
              p_raw_content: parsed.rawContent,
            },
          );
          if (error) throw error;
          if (inserted) {
            result.imported += 1;
            webhookActivity.set(message.webhook_id, true);
          } else {
            result.duplicates += 1;
          }
        }
      }

      const newest = newestMessageId(messages);
      const update: Record<string, unknown> = {
        initial_sync_completed: true,
        last_synced_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      };
      if (newest) update.last_message_id = newest;
      const { error: updateError } = await db.from("discord_channels").update(
        update,
      ).eq("channel_id", channel.channel_id);
      if (updateError) throw updateError;
    } catch (error) {
      const message = `Salon ${channel.channel_id}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      result.errors.push(message);
      await db.from("discord_channels").update({
        last_error: message,
        updated_at: new Date().toISOString(),
      }).eq("channel_id", channel.channel_id);
    }
  }

  await db.from("sync_runs").update({
    completed_at: new Date().toISOString(),
    inspected: result.inspected,
    imported: result.imported,
    duplicates: result.duplicates,
    ignored: result.ignored,
    errors: result.errors,
  }).eq("id", run.id);

  return json(request, result, result.errors.length > 0 ? 207 : 200);
});
