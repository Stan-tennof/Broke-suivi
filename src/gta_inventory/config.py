from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_url: str
    discord_bot_token: str | None
    discord_channel_ids: set[int]
    admin_password: str | None


def _parse_channel_ids(raw: str | None) -> set[int]:
    if not raw:
        return set()
    channel_ids: set[int] = set()
    for value in raw.split(","):
        value = value.strip()
        if value:
            channel_ids.add(int(value))
    return channel_ids


def get_settings() -> Settings:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    return Settings(
        database_url=database_url,
        discord_bot_token=os.getenv("DISCORD_BOT_TOKEN"),
        discord_channel_ids=_parse_channel_ids(os.getenv("DISCORD_CHANNEL_IDS")),
        admin_password=os.getenv("ADMIN_PASSWORD"),
    )
