# GTA Discord Inventory Tracker

Python app with a `discord.py` ingestion bot, PostgreSQL storage, and a hosted Streamlit dashboard.

It parses Discord webhook messages like:

```text
**Chest name**
**Player name** a retiré 39x Item name
```

or:

```text
**Chest name**
**Player name** a déposé 39x Item name
```

Each parsed message is stored once using the Discord message ID as the duplicate guard.

## Features

- Stores message ID, webhook ID, chest, player, action, quantity, item, and timestamp.
- Computes total inventory across all chests.
- Shows inventory per chest and webhook.
- Shows transaction history with player, item, chest, and date filters.
- Supports manual inventory adjustments.
- Includes an admin page for associating webhook IDs with chest names.
- Keeps all secrets in environment variables.

## Local Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` with your Supabase or local PostgreSQL URL and Discord bot token.

Initialize the database:

```powershell
python -m gta_inventory.db
```

Run the bot:

```powershell
python -m gta_inventory.bot
```

Run the dashboard:

```powershell
streamlit run src/gta_inventory/dashboard.py
```

## Discord Bot Setup

1. Create a bot in the Discord Developer Portal.
2. Enable the `Message Content Intent`.
3. Invite the bot to the server with permission to read message history and view the target channels.
4. Set `DISCORD_BOT_TOKEN`.
5. Optional: set `DISCORD_CHANNEL_IDS` to a comma-separated list of channel IDs. Leave it blank to process every visible channel.

Webhook messages should be visible to the bot. Discord exposes the originating webhook ID on `message.webhook_id`, which is stored with each transaction.

## Supabase

Create a Supabase project and copy the pooled or direct PostgreSQL connection string into `DATABASE_URL`.

Use SSL if your connection string requires it. Supabase URLs usually work directly with `psycopg`.

## Render

This repo includes `render.yaml` with:

- a worker service for the Discord bot
- a web service for Streamlit

Create a Blueprint from the repo in Render, then set these environment variables:

- `DATABASE_URL`
- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNEL_IDS` optional
- `ADMIN_PASSWORD`

The app creates or migrates its tables on startup.
