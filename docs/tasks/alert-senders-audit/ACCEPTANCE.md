# ACCEPTANCE — alert-senders-audit

| AC | Owner | Env | Steps | Expected | Evidence |
|---|---|---|---|---|---|
| AC-01 | Codex | local | checks + tests | green | output + SHA |
| AC-02 | Codex | RESULT | inventory table | complete, every row has compliant yes/no | table |
| AC-03 | Codex | local test | each fixed sender with a foreign-org device | no send, reason recorded | test |
| AC-04 | Codex | repo grep | readers of WA_NOTIFY_ORG_ID | none use it as org id | output |
| AC-10 | Cowork | review | inventory vs live deployed functions | matches | VERIFY |