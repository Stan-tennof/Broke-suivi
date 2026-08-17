import unittest

from gta_inventory.parser import (
    ACTION_DEPOSIT,
    ACTION_WITHDRAW,
    parse_transaction_message,
    signed_quantity,
)


class ParserTests(unittest.TestCase):
    def test_withdrawal_message(self):
        parsed = parse_transaction_message("**Chest name**\n**Player name** a retiré 39x Item name")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.chest, "Chest name")
        self.assertEqual(parsed.player, "Player name")
        self.assertEqual(parsed.action, ACTION_WITHDRAW)
        self.assertEqual(parsed.quantity, 39)
        self.assertEqual(parsed.item, "Item name")

    def test_deposit_message(self):
        parsed = parse_transaction_message("**Chest name**\n**Player name** a déposé 39x Item name")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.action, ACTION_DEPOSIT)

    def test_ignores_unrelated_messages(self):
        self.assertIsNone(parse_transaction_message("hello"))

    def test_signed_quantity(self):
        self.assertEqual(signed_quantity(ACTION_DEPOSIT, 4), 4)
        self.assertEqual(signed_quantity(ACTION_WITHDRAW, 4), -4)


if __name__ == "__main__":
    unittest.main()
