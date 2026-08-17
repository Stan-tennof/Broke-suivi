from __future__ import annotations

from datetime import date, datetime, time, timezone

import pandas as pd
import streamlit as st

from gta_inventory.config import get_settings
from gta_inventory.db import (
    distinct_values,
    init_db,
    insert_manual_adjustment,
    list_webhook_chests,
    upsert_webhook_chest,
)
from gta_inventory.db import dataframe as read_df


st.set_page_config(page_title="GTA Inventory", layout="wide")


@st.cache_resource
def bootstrap() -> None:
    init_db()


def require_admin(key: str) -> bool:
    settings = get_settings()
    if not settings.admin_password:
        return True
    password = st.sidebar.text_input("Admin password", type="password", key=key)
    return password == settings.admin_password


def to_utc_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


def to_utc_end(day: date) -> datetime:
    return datetime.combine(day, time.max, tzinfo=timezone.utc)


def filters() -> tuple[list[str], list[str], list[str], datetime, datetime]:
    players = distinct_values("player")
    items = distinct_values("item")
    chests = distinct_values("chest")

    with st.sidebar:
        st.header("Filters")
        selected_players = st.multiselect("Player", players)
        selected_items = st.multiselect("Item", items)
        selected_chests = st.multiselect("Chest", chests)
        start_day = st.date_input("Start date", value=date(2020, 1, 1))
        end_day = st.date_input("End date", value=date.today())

    return (
        selected_players,
        selected_items,
        selected_chests,
        to_utc_start(start_day),
        to_utc_end(end_day),
    )


def where_clause(
    players: list[str],
    items: list[str],
    chests: list[str],
    start_at: datetime,
    end_at: datetime,
) -> tuple[str, dict]:
    clauses = ["occurred_at BETWEEN %(start_at)s AND %(end_at)s"]
    params: dict[str, object] = {"start_at": start_at, "end_at": end_at}

    if players:
        clauses.append("player = ANY(%(players)s)")
        params["players"] = players
    if items:
        clauses.append("item = ANY(%(items)s)")
        params["items"] = items
    if chests:
        clauses.append("chest = ANY(%(chests)s)")
        params["chests"] = chests

    return " AND ".join(clauses), params


def inventory_total(where_sql: str, params: dict) -> pd.DataFrame:
    return read_df(
        f"""
        SELECT item, SUM(signed_quantity)::INTEGER AS quantity
        FROM transactions
        WHERE {where_sql}
        GROUP BY item
        HAVING SUM(signed_quantity) <> 0
        ORDER BY item
        """,
        params,
    )


def inventory_by_chest(where_sql: str, params: dict) -> pd.DataFrame:
    return read_df(
        f"""
        SELECT chest, webhook_id, item, SUM(signed_quantity)::INTEGER AS quantity
        FROM transactions
        WHERE {where_sql}
        GROUP BY chest, webhook_id, item
        HAVING SUM(signed_quantity) <> 0
        ORDER BY chest, item
        """,
        params,
    )


def transaction_history(where_sql: str, params: dict) -> pd.DataFrame:
    return read_df(
        f"""
        SELECT
            occurred_at,
            source,
            discord_message_id,
            webhook_id,
            chest,
            player,
            action,
            quantity,
            signed_quantity,
            item
        FROM transactions
        WHERE {where_sql}
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1000
        """,
        params,
    )


def show_dashboard() -> None:
    st.title("GTA Inventory")
    selected_players, selected_items, selected_chests, start_at, end_at = filters()
    where_sql, params = where_clause(selected_players, selected_items, selected_chests, start_at, end_at)

    total_df = inventory_total(where_sql, params)
    by_chest_df = inventory_by_chest(where_sql, params)
    history_df = transaction_history(where_sql, params)

    deposits = int(history_df.loc[history_df["signed_quantity"] > 0, "signed_quantity"].sum()) if not history_df.empty else 0
    withdrawals = abs(int(history_df.loc[history_df["signed_quantity"] < 0, "signed_quantity"].sum())) if not history_df.empty else 0

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Items tracked", len(total_df.index))
    c2.metric("Net quantity", int(total_df["quantity"].sum()) if not total_df.empty else 0)
    c3.metric("Deposited / added", deposits)
    c4.metric("Withdrawn / removed", withdrawals)

    tab_total, tab_chests, tab_history, tab_adjust, tab_admin = st.tabs(
        ["Total Inventory", "Chest Inventory", "Transactions", "Adjustments", "Admin"]
    )

    with tab_total:
        st.dataframe(total_df, use_container_width=True, hide_index=True)

    with tab_chests:
        st.dataframe(by_chest_df, use_container_width=True, hide_index=True)

    with tab_history:
        st.dataframe(history_df, use_container_width=True, hide_index=True)

    with tab_adjust:
        st.subheader("Manual initial inventory adjustment")
        if require_admin("adjustment_admin_password"):
            with st.form("manual_adjustment"):
                chest = st.text_input("Chest")
                player = st.text_input("Player", value="admin")
                item = st.text_input("Item")
                quantity_delta = st.number_input("Quantity delta", step=1, value=0)
                submitted = st.form_submit_button("Add adjustment")
            if submitted:
                if not chest.strip() or not item.strip() or int(quantity_delta) == 0:
                    st.error("Chest, item, and a non-zero quantity delta are required.")
                else:
                    insert_manual_adjustment(
                        chest=chest.strip(),
                        player=player.strip() or "admin",
                        item=item.strip(),
                        quantity_delta=int(quantity_delta),
                    )
                    st.success("Adjustment stored.")
                    st.rerun()
        else:
            st.warning("Enter the admin password in the sidebar.")

    with tab_admin:
        st.subheader("Webhook chest associations")
        st.dataframe(list_webhook_chests(), use_container_width=True, hide_index=True)
        if require_admin("mapping_admin_password"):
            with st.form("webhook_mapping"):
                webhook_id = st.text_input("Webhook ID")
                chest = st.text_input("Chest name")
                notes = st.text_area("Notes")
                submitted = st.form_submit_button("Save association")
            if submitted:
                if not webhook_id.strip() or not chest.strip():
                    st.error("Webhook ID and chest name are required.")
                else:
                    upsert_webhook_chest(webhook_id.strip(), chest.strip(), notes.strip() or None)
                    st.success("Association saved.")
                    st.rerun()
        else:
            st.warning("Enter the admin password in the sidebar.")


bootstrap()
show_dashboard()
