from __future__ import annotations

import re
from dataclasses import dataclass


ACTION_DEPOSIT = "deposit"
ACTION_WITHDRAW = "withdraw"
ACTION_ADJUSTMENT = "adjustment"

ACTION_WORDS = {
    "déposé": ACTION_DEPOSIT,
    "depose": ACTION_DEPOSIT,
    "retiré": ACTION_WITHDRAW,
    "retire": ACTION_WITHDRAW,
}

MESSAGE_RE = re.compile(
    r"^\s*\*\*(?P<chest>.+?)\*\*\s*\n\s*"
    r"\*\*(?P<player>.+?)\*\*\s+a\s+"
    r"(?P<verb>déposé|depose|retiré|retire)\s+"
    r"(?P<quantity>\d+)x\s+(?P<item>.+?)\s*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ParsedTransaction:
    chest: str
    player: str
    action: str
    quantity: int
    item: str


def parse_transaction_message(content: str) -> ParsedTransaction | None:
    match = MESSAGE_RE.match(content)
    if not match:
        return None

    verb = match.group("verb").casefold()
    return ParsedTransaction(
        chest=match.group("chest").strip(),
        player=match.group("player").strip(),
        action=ACTION_WORDS[verb],
        quantity=int(match.group("quantity")),
        item=match.group("item").strip(),
    )


def signed_quantity(action: str, quantity: int) -> int:
    if action == ACTION_DEPOSIT:
        return quantity
    if action == ACTION_WITHDRAW:
        return -quantity
    if action == ACTION_ADJUSTMENT:
        return quantity
    raise ValueError(f"Unknown action: {action}")
