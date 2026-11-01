# LOGIC — alert-senders-audit

Facts (2026-11-01): `WA_NOTIFY_ORG_ID` in `platform_config_store` now holds the session key `c3aa7a0d-461a-4ed4-882a-58bd063b1e62__84920ad6` (Otomator device, phone 972528393669) — changed today by Cowork from the bare org id. Any code that reads it as an org UUID is now wrong and must be fixed. 2026-10-28: WA outage alerts went out via a customer's device (Yoni Hillel) because of a cross-org fallback.

Rules:
1. Inventory table in RESULT: function/service · recipient · channel · sender resolution · setting read · compliant yes/no.
2. Compliant = sender is proven to belong to org `c3aa7a0d-461a-4ed4-882a-58bd063b1e62` (or platform email), no fallback chain to other orgs.
3. Fix each violation the same way as `system-error-notify` (gate + skip, never pick another org).
4. Readers of `WA_NOTIFY_ORG_ID` expecting an org id: switch them to `OTOMATOR_ORG_ID` for org lookups.