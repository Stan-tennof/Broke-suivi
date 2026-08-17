from __future__ import annotations

import logging

import discord

from gta_inventory.config import get_settings
from gta_inventory.db import init_db, insert_discord_transaction
from gta_inventory.parser import parse_transaction_message


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


class InventoryBot(discord.Client):
    def __init__(self, channel_ids: set[int]) -> None:
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(intents=intents)
        self.channel_ids = channel_ids

    async def on_ready(self) -> None:
        log.info("Logged in as %s (%s)", self.user, self.user.id if self.user else "unknown")

    async def on_message(self, message: discord.Message) -> None:
        if message.author == self.user:
            return
        if self.channel_ids and message.channel.id not in self.channel_ids:
            return

        parsed = parse_transaction_message(message.content)
        if not parsed:
            return

        inserted = insert_discord_transaction(
            discord_message_id=message.id,
            webhook_id=message.webhook_id,
            parsed=parsed,
            occurred_at=message.created_at,
            raw_content=message.content,
        )
        if inserted:
            log.info(
                "Stored %s %sx %s for %s in %s from message %s",
                parsed.action,
                parsed.quantity,
                parsed.item,
                parsed.player,
                parsed.chest,
                message.id,
            )
        else:
            log.info("Skipped duplicate Discord message %s", message.id)


def main() -> None:
    settings = get_settings()
    if not settings.discord_bot_token:
        raise RuntimeError("DISCORD_BOT_TOKEN is required")

    init_db()
    InventoryBot(settings.discord_channel_ids).run(settings.discord_bot_token)


if __name__ == "__main__":
    main()
