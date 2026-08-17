from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

import pandas as pd
import psycopg
from psycopg.rows import dict_row

from gta_inventory.config import get_settings
from gta_inventory.parser import ACTION_ADJUSTMENT, ParsedTransaction, signed_quantity


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS webhook_chests (
    webhook_id TEXT PRIMARY KEY,
    chest TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    discord_message_id TEXT UNIQUE,
    webhook_id TEXT,
    chest TEXT NOT NULL,
    player TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('deposit', 'withdraw', 'adjustment')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    signed_quantity INTEGER NOT NULL,
    item TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    raw_content TEXT,
    source TEXT NOT NULL DEFAULT 'discord',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_player ON transactions (player);
CREATE INDEX IF NOT EXISTS idx_transactions_item ON transactions (item);
CREATE INDEX IF NOT EXISTS idx_transactions_chest ON transactions (chest);
CREATE INDEX IF NOT EXISTS idx_transactions_webhook_id ON transactions (webhook_id);
"""


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    settings = get_settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        yield conn


def init_db() -> None:
    with connect() as conn:
        conn.execute(SCHEMA_SQL)
        conn.commit()


def upsert_webhook_chest(webhook_id: str, chest: str, notes: str | None = None) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO webhook_chests (webhook_id, chest, notes, updated_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (webhook_id)
            DO UPDATE SET chest = EXCLUDED.chest, notes = EXCLUDED.notes, updated_at = NOW()
            """,
            (webhook_id, chest, notes),
        )
        conn.commit()


def get_webhook_chest(webhook_id: str | None) -> str | None:
    if not webhook_id:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT chest FROM webhook_chests WHERE webhook_id = %s",
            (webhook_id,),
        ).fetchone()
    return row["chest"] if row else None


def insert_discord_transaction(
    *,
    discord_message_id: int,
    webhook_id: int | None,
    parsed: ParsedTransaction,
    occurred_at: datetime,
    raw_content: str,
) -> bool:
    mapped_chest = get_webhook_chest(str(webhook_id) if webhook_id else None)
    chest = mapped_chest or parsed.chest

    with connect() as conn:
        result = conn.execute(
            """
            INSERT INTO transactions (
                discord_message_id, webhook_id, chest, player, action, quantity,
                signed_quantity, item, occurred_at, raw_content, source
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'discord')
            ON CONFLICT (discord_message_id) DO NOTHING
            """,
            (
                str(discord_message_id),
                str(webhook_id) if webhook_id else None,
                chest,
                parsed.player,
                parsed.action,
                parsed.quantity,
                signed_quantity(parsed.action, parsed.quantity),
                parsed.item,
                occurred_at,
                raw_content,
            ),
        )
        conn.commit()
        return result.rowcount == 1


def insert_manual_adjustment(
    *,
    chest: str,
    player: str,
    item: str,
    quantity_delta: int,
    occurred_at: datetime | None = None,
) -> None:
    if quantity_delta == 0:
        raise ValueError("quantity_delta cannot be zero")

    quantity = abs(quantity_delta)
    when = occurred_at or datetime.now(timezone.utc)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO transactions (
                discord_message_id, webhook_id, chest, player, action, quantity,
                signed_quantity, item, occurred_at, raw_content, source
            )
            VALUES (NULL, NULL, %s, %s, %s, %s, %s, %s, %s, NULL, 'manual')
            """,
            (chest, player, ACTION_ADJUSTMENT, quantity, quantity_delta, item, when),
        )
        conn.commit()


def dataframe(query: str, params: tuple | dict | None = None) -> pd.DataFrame:
    with connect() as conn:
        return pd.read_sql_query(query, conn, params=params)


def list_webhook_chests() -> pd.DataFrame:
    return dataframe(
        """
        SELECT webhook_id, chest, notes, created_at, updated_at
        FROM webhook_chests
        ORDER BY chest, webhook_id
        """
    )


def distinct_values(column: str) -> list[str]:
    allowed = {"player", "item", "chest", "webhook_id"}
    if column not in allowed:
        raise ValueError(f"Unsupported column: {column}")

    df = dataframe(
        f"""
        SELECT DISTINCT {column}
        FROM transactions
        WHERE {column} IS NOT NULL AND {column} <> ''
        ORDER BY {column}
        """
    )
    return [str(value) for value in df[column].dropna().tolist()]


if __name__ == "__main__":
    init_db()
    print("Database schema is ready.")
