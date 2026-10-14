# JumpStart WhatsApp service — Architecture v2 (resilient, load-balanced, protected)

Date: 2026-10-13 · Updated 2026-10-14 with Nizan's decisions · Status: APPROVED direction (production actions still per-item approval) · Repos: `jumpstart-whatsapp-service`, `jumpstart`

## Requirements (Nizan, 2026-10-13)
1. No one reaches the server directly.
2. Behind a load balancer now.
3. Able to run as microservices.
4. Device creation shows only "רשמי / לא רשמי" with an explanation — never "Baileys" or provider names. (DONE — PR #3308 live 2026-10-14)
5. If a server crashes, the service keeps working (bring up capacity automatically).

## Nizan's decisions (authoritative)
- 2026-10-13 · Load balancing in **Cloudflare**, not Hetzner — a node from another provider must be able to join the pool if Hetzner fails. No correctness dependency on Hetzner-only networking (vSwitch etc.).
- 2026-10-13 · Shared state in the **otomator-admin Supabase project (`mzalzjtsyrjycaxolldv`)**, where the WA registry already lives (`whatsapp_devices`, `wa_partners`, `wa_platform_config`). Own schema, not exposed via PostgREST, dedicated least-privilege DB role. Migrations delivered as files + rollback; applied only with his approval in the night window.
- 2026-10-13 · Wants a **fleet management system** that samples capacity and recommends "add a node" vs "upgrade a node" before `wa-prod-2` is created. Provisioning is a provider-agnostic module, called only by an explicit approved action in phase 1.
- 2026-10-13 · SSH unchanged (key-only + fail2ban).
- 2026-10-14 · **Fencing = A + B together** (see §Fencing). If fencing of the old owner cannot be confirmed, takeover fails closed and Nizan is alerted.
- 2026-10-14 · Cloudflare origin auth uses a **zone/hostname-specific** Authenticated Origin Pulls certificate (our own client cert), not the global Cloudflare AOP cert.

## Verified current state (2026-10-13)
- One server `wa-prod-1` (Hetzner CCX13, Nuremberg). One container; nginx is the live proxy. 12 sessions / 5 connected at last audit (2026-09-30).
- Origin protection done 2026-09-30: UFW + Hetzner firewall allow 80/443 only from Cloudflare ranges; direct IP times out. SSH key-only + fail2ban.
- Not done: origin cert self-signed; Cloudflare not "Full (strict)"; reboot pending.
- Nightly encrypted backup of `sessions-data` to R2 works.
- Auth state on local disk (`sessions/<key>/`) with a file single-writer lock (`src/lib/sessionAuthLock.ts`) — NOT a cross-node fence.
- No standby server exists.

## The constraint that shapes everything
An unofficial WhatsApp number may be live on **exactly one socket** at a time. Two sockets = "stream replaced" loops, broken encryption, logout and ban risk. So:
- Load balancing is **per session (sharding)**, not round-robin.
- Failover must **fence** the old owner's actual WhatsApp connection before a new node connects. A DB lease alone is not a fence: WhatsApp does not participate in our DB protocol.
- Official (Meta Cloud API) numbers are stateless HTTP — they load-balance freely.

## Fencing (decided 2026-10-14: A + B)
**A — Self-fence (every node, always on)**
- Each node holds `session_lease(session_key, owner_node, epoch, expires_at)`; lease TTL 60 s, renewed every ~5 s.
- If a node cannot renew within **15 s** (DB unreachable, slow, or any doubt), it closes **all** its WhatsApp sockets itself and stops sending — before anyone else may claim.
- A watchdog independent of the Node event loop (e.g. Docker/systemd healthcheck on a heartbeat file, or a sidecar) kills the service process if the heartbeat stalls > 15 s.
- Every auth-state write and every send carries the epoch; a stale epoch is rejected (DB-side check).

**B — Confirmed power-off before takeover (STONITH)**
- A survivor may claim a dead node's sessions only after: (1) the leases expired, AND (2) it powered off the old node through the provider API (Hetzner first, behind a provider-agnostic `NodeFencer` interface) AND confirmed via the API that it is off.
- If (2) cannot be confirmed (provider API error/timeout, unknown node, other provider without a fencer), takeover **fails closed**: sessions stay unowned, an alert goes to Nizan, and a manual "confirm node is dead → take over" action exists.
- A fenced (powered-off) node never auto-restarts into service; rejoining is an explicit action.
- Target: real node death → sessions resumed on survivor in ~60–90 s, no QR.

**Rejected:** C — single egress/ownership gate (adds a single point of failure, contradicts requirement 5).

## Target architecture
```
Clients / Edge Functions / Partner API
            │  HTTPS only
     Cloudflare (WAF, rate limits, Load Balancer + health checks)
            │  Cloudflare Tunnel (no public inbound ports) — phase 2
   API gateway ×2+   (stateless: auth, validation, routing, QR proxy)
   ├── Session workers ×N  (stateful: own numbers via lease + fencing)
   ├── Official-API worker (stateless)
   ├── Webhook dispatcher (queue → signed delivery, retries)
   └── Scheduler (single leader via lease)
 Shared state: Postgres in mzalz (own schema: leases, encrypted auth state, queues, capacity samples) + R2 (media, backups)
```

### 1. No direct access
- Phase 1: Cloudflare Origin CA cert, **Full (strict)**, **zone-specific Authenticated Origin Pulls** (own client cert). Firewall stays Cloudflare-only.
- Phase 2: Cloudflare Tunnel on every node; close 80/443.
- Per-caller API keys replace the single `API_SECRET` (phase 2).

### 2. Load balancer
- Cloudflare Load Balancer, pools per node, `/health` checks. Health must reflect "can serve", and traffic for a number must reach its lease owner (gateway routing or owner-aware health).
- Phase 1: active/standby. Phase 2: active-active sharding.

### 3. Microservices
Same repo/image, role via `WA_ROLE=gateway|session|official|dispatch|scheduler`. Extract from today's `src/`, no rewrite.

### 4. Device copy — DONE (PR #3308).

### 5. Survive a crash
- Auth state replicated encrypted (per session) to shared Postgres → any worker resumes without QR.
- Leases + epochs + fencing A+B as above.
- Queued outbound messages held and retried after the move; webhooks queued in Postgres.
- Capacity samples per node (CPU, RAM, disk, sessions owned/connected, msgs/min, lease renew latency) → fleet view in otomator-admin recommends add vs upgrade (follow-up task).
- Phase 3: auto-provision replacement nodes (golden image + provider API) after Nizan approves that automation.

## Phases
| Phase | Scope |
|---|---|
| 1 — now | Origin CA + Full (strict) + zone AOP; leases + epochs + fencing A+B; encrypted auth-state replication; capacity samples; provisioning + fencer modules; standby node (after approval); Cloudflare LB (after approval) |
| 2 | Tunnel, close 80/443; role split; active-active; per-caller keys |
| 3 | Auto-provision; quotas; monthly failover drills |

## Approval boundaries (unchanged)
Every production action needs Nizan's explicit go per item, in the 23:00–06:00 IL window: applying migrations to mzalz, creating wa-prod-2 or any paid resource, enabling Cloudflare LB/Tunnel/AOP, DNS/SSL changes, deploy/restart wa-prod-1, moving any customer session, activating automatic power-off in production.
