# DECISIONS — alert-senders-audit

| If you find… | Do |
|---|---|
| a sender with fallback to "any connected device" | remove the fallback; email instead |
| sender lives in another repo | separate PR in that repo, same rules |
| unclear whether a message is "to Otomator" | treat as Otomator-bound if recipient is a platform setting phone/email |

Default rule: fail closed (no WhatsApp) rather than borrow a device.