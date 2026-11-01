# Synthetic American Express-style transactions

`amex-synthetic-transactions.csv` contains 25 fictional USD card transactions for September 2026. It mimics statement merchant descriptors and includes software, travel, meals, equipment, professional services, advertising, fees, refunds, a card payment, and ambiguous merchants. Every transaction, cardholder, and reference is synthetic. This is a curated classifier fixture, not an official American Express export.

Import it through `/transactions` → **Upload CSV**. The file uses the app's signed-amount convention: purchases and fees are negative; refunds, credits, and payments into the card account are positive. Convert signs before importing a real issuer export if its convention differs. Extra cardholder, account-label, and reference columns are ignored by the importer.

Use the vague marketplace and PayPal rows to inspect uncertainty and review handling. The own-account card payment should be a transfer. Supplier refunds should retain refund movement semantics; the current demo groups supplier refunds under its `Income` display category, so do not interpret that label as accounting or tax treatment. Statement credits may require review. The fixture provides test inputs, not guaranteed model outcomes.
