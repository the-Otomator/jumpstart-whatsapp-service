# WorkMatch ↔ WhatsApp Service — Integration Guide

> **Service:** `https://wa.otomator.pro`
> **Auth:** `Authorization: Bearer <API_SECRET>`
> **Protocol:** HTTPS only, JSON request/response

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Session Lifecycle](#session-lifecycle)
4. [Sending Messages](#sending-messages)
5. [Receiving Messages (Webhooks)](#receiving-messages-webhooks)
6. [Connect Page (QR Pairing)](#connect-page-qr-pairing)
7. [Status Polling](#status-polling)
8. [Error Handling](#error-handling)
9. [Rate Limits & Best Practices](#rate-limits--best-practices)
10. [Full Flow Example](#full-flow-example)

---

## Overview

The WhatsApp Service is a multi-tenant microservice that manages WhatsApp Web sessions via Baileys. Each organization (tenant) gets one WhatsApp session identified by `orgId`.

WorkMatch connects to this service to:
- **Send** WhatsApp messages to candidates/employers (text, images, documents, etc.)
- **Receive** incoming WhatsApp messages via webhook callbacks
- **Manage** the WhatsApp device connection (connect, disconnect, status)

### Architecture

```
WorkMatch Backend
    │
    ├── POST /api/messages/send ──────► WhatsApp Service ──► WhatsApp
    ├── POST /api/sessions/:orgId/start
    ├── GET  /api/sessions/:orgId/status
    │
    │   ◄── Webhook POST ──────────── WhatsApp Service ◄── WhatsApp
    │       (incoming messages,
    │        connection events,
    │        delivery receipts)
    │
WorkMatch Frontend
    │
    └── iframe/redirect ──► /connect/:orgId  (QR pairing page, no auth)
```

---

## Authentication

All `/api/*` endpoints require a Bearer token:

```
Authorization: Bearer <API_SECRET>
```

**Important:** The API_SECRET must NEVER be exposed in frontend code. All API calls must go through the WorkMatch backend.

### Public endpoints (no auth required)

| Endpoint | Description |
|---|---|
| `GET /connect/:orgId` | QR pairing HTML page |
| `GET /connect/:orgId/status` | Session status (for frontend polling) |
| `GET /health` | Service health check |

---

## Session Lifecycle

### 1. Start a Session

```http
POST /api/sessions/:orgId/start
Authorization: Bearer <API_SECRET>
Content-Type: application/json

{
  "webhookUrl": "https://workmatch.example.com/api/webhooks/whatsapp",
  "autoRestore": true
}
```

**Response (200):**
```json
{
  "orgId": "wm-org-123",
  "status": "connecting"
}
```

The session transitions through states: `connecting` → `qr` → `connected`.

> **Note:** The service validates the orgId against Supabase `central_subscriptions`. The org must have an active subscription to the `whatsapp-service` product.

### 2. Check Session Status

```http
GET /api/sessions/:orgId/status
Authorization: Bearer <API_SECRET>
```

**Response (200):**
```json
{
  "orgId": "wm-org-123",
  "status": "connected",
  "phoneNumber": "972501234567"
}
```

**Possible `status` values:**

| Status | Meaning |
|---|---|
| `connecting` | Session initializing, waiting for QR |
| `qr` | QR code ready, waiting for scan |
| `connected` | Fully connected, ready to send/receive |
| `disconnected` | Lost connection (auto-reconnect in 5s) |

### 3. Stop a Session

```http
DELETE /api/sessions/:orgId
Authorization: Bearer <API_SECRET>
```

To also purge all stored credentials (force new QR on next connect):

```http
DELETE /api/sessions/:orgId?purge=true
Authorization: Bearer <API_SECRET>
```

Or use the dedicated purge endpoint:

```http
POST /api/sessions/:orgId/purge
Authorization: Bearer <API_SECRET>
```

### 4. List All Sessions

```http
GET /api/sessions
Authorization: Bearer <API_SECRET>
```

**Response (200):**
```json
[
  {
    "orgId": "wm-org-123",
    "status": "connected",
    "phoneNumber": "972501234567",
    "webhookUrl": "https://workmatch.example.com/api/webhooks/whatsapp"
  }
]
```

---

## Sending Messages

### Single Message

```http
POST /api/messages/send
Authorization: Bearer <API_SECRET>
Content-Type: application/json
```

**Alternative path (same behavior):**
```http
POST /api/sessions/:orgId/send
```

### Message Types & Payloads

#### Text

```json
{
  "orgId": "wm-org-123",
  "to": "972501234567",
  "type": "text",
  "message": "שלום! יש לנו משרה חדשה שמתאימה לך"
}
```

#### Image (with URL)

```json
{
  "orgId": "wm-org-123",
  "to": "972501234567",
  "type": "image",
  "mediaUrl": "https://workmatch.example.com/jobs/poster-123.jpg",
  "message": "פרטי המשרה מצורפים"
}
```

#### Image (with base64)

```json
{
  "orgId": "wm-org-123",
  "to": "972501234567",
  "type": "image",
  "mediaBase64": "data:image/jpeg;base64,/9j/4AAQ...",
  "message": "פרטי המשרה מצורפים"
}
```

#### Document (PDF, DOCX, etc.)

```json
{
  "orgId": "wm-org-123",
  "to": "972501234567",
  "type": "document",
  "mediaUrl": "https://workmatch.example.com/resumes/candidate-456.pdf",
  "filename": "resume.pdf",
  "mimetype": "application/pdf",
  "message": "קורות החיים של המועמד"
}
```

#### Video

```json
{
  "orgId": "wm-org-123",
  "to": "972501234567",
  "type": "video",
  "mediaUrl": "https://workmatch.example.com/videos/intro.mp4",
  "message": "סרטון היכרות"
}
```

#### Audio

```json
{
  "orgId": "wm-org-123",
  "to": "972501234567",
  "type": "audio",
  "mediaUrl": "https://workmatch.example.com/audio/message.mp3"
}
```

#### Location

```json
{
  "orgId": "wm-org-123",
  "to": "972501234567",
  "type": "location",
  "latitude": 32.0853,
  "longitude": 34.7818
}
```

#### Contact (vCard)

```json
{
  "orgId": "wm-org-123",
  "to": "972501234567",
  "type": "contact",
  "contactName": "דני כהן",
  "contactPhone": "972521234567"
}
```

### Success Response (200)

```json
{
  "messageId": "3EB0B430A..."
}
```

### Bulk Sending

```http
POST /api/messages/send-bulk
Authorization: Bearer <API_SECRET>
Content-Type: application/json
```

```json
{
  "orgId": "wm-org-123",
  "messages": [
    { "to": "972501234567", "type": "text", "message": "משרה חדשה!" },
    { "to": "972509876543", "type": "text", "message": "משרה חדשה!" },
    { "to": "972525555555", "type": "text", "message": "משרה חדשה!" }
  ]
}
```

**Note:** The service enforces a **1500ms delay** between each message to avoid WhatsApp throttling. Plan accordingly for large batches.

**Response (200):**
```json
{
  "results": [
    { "to": "972501234567", "messageId": "3EB0B430A...", "success": true },
    { "to": "972509876543", "messageId": "3EB0C531B...", "success": true },
    { "to": "972525555555", "error": "not a valid WhatsApp number", "success": false }
  ]
}
```

### Phone Number Format

- Send Israeli numbers as `972XXXXXXXXX` (no `+`, no `-`, no leading `0`)
- The service automatically strips non-digit characters and appends `@s.whatsapp.net`
- Examples: `972501234567`, `972521234567`

---

## Receiving Messages (Webhooks)

When starting a session, provide a `webhookUrl`. The service will POST events to that URL.

### Webhook Endpoint Requirements

WorkMatch must expose an HTTPS endpoint that:
1. Accepts POST requests with JSON body
2. Returns HTTP 200-299 within 10 seconds
3. Is publicly accessible from the VPS (147.93.127.180)

### Event: Incoming Message

```json
{
  "event": "message",
  "orgId": "wm-org-123",
  "messageId": "3EB0B430A...",
  "from": "972501234567",
  "fromName": "דני כהן",
  "message": "אני מעוניין במשרה",
  "timestamp": 1712300000,
  "isGroup": false,
  "groupId": null,
  "mediaType": null
}
```

**`mediaType` values:** `null`, `"image"`, `"video"`, `"audio"`, `"document"`, `"sticker"`

> When `mediaType` is not null, the `message` field may contain the caption (if any) or be empty.

### Event: Connection Status

```json
{
  "event": "connected",
  "orgId": "wm-org-123",
  "phone": "972501234567"
}
```

```json
{
  "event": "disconnected",
  "orgId": "wm-org-123",
  "reason": "Connection lost"
}
```

### Event: QR Code Ready

```json
{
  "event": "qr",
  "orgId": "wm-org-123",
  "qr": "<base64-encoded-qr>"
}
```

### Event: Message Delivery Status

```json
{
  "event": "message_status",
  "orgId": "wm-org-123",
  "messageId": "3EB0B430A...",
  "status": "delivered",
  "to": "972501234567"
}
```

**`status` values:** `"sent"`, `"delivered"`, `"read"`

### Retry Policy

If the webhook POST fails (timeout, non-2xx, network error), the service retries:

| Attempt | Delay |
|---|---|
| 1st retry | 1 second |
| 2nd retry | 5 seconds |
| 3rd retry | 15 seconds |

After 3 failed retries, the event is logged in the failure log (max 100 entries).

### View / Clear Webhook Failures

```http
GET /api/sessions/:orgId/webhook-failures
Authorization: Bearer <API_SECRET>
```

```http
DELETE /api/sessions/:orgId/webhook-failures
Authorization: Bearer <API_SECRET>
```

---

## Connect Page (QR Pairing)

The service provides a ready-made QR pairing page at:

```
https://wa.otomator.pro/connect/:orgId
```

This page is **public** (no auth required), Hebrew RTL, dark theme. It handles the full QR flow: display QR → poll for status → show success.

### Embedding in WorkMatch

**Option A — iframe (recommended for SPA):**

```html
<iframe
  src="https://wa.otomator.pro/connect/wm-org-123"
  style="border: none; width: 100%; height: 600px; border-radius: 16px;"
/>
```

**Option B — New tab/redirect:**

```javascript
window.open(`https://wa.otomator.pro/connect/${orgId}`, '_blank');
```

---

## Status Polling

For frontend status checks (no auth needed):

```http
GET /connect/:orgId/status
```

**Response:**
```json
{
  "status": "connected",
  "phoneNumber": "972501234567"
}
```

Poll every 5-10 seconds from the WorkMatch frontend to keep the UI in sync.

---

## Error Handling

All errors return structured JSON:

```json
{
  "error": "Session not found",
  "code": "SESSION_NOT_FOUND"
}
```

### Common Error Codes

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `AUTH_MISSING` | No Authorization header |
| 401 | `AUTH_INVALID` | Wrong Bearer token |
| 404 | `SESSION_NOT_FOUND` | orgId has no active session |
| 400 | `VALIDATION_ERROR` | Request body failed Zod validation |
| 409 | `SESSION_EXISTS` | Session already running for this orgId |
| 500 | `SEND_FAILED` | Message send failed (WhatsApp error) |

---

## Rate Limits & Best Practices

1. **API rate limit:** 100 requests/minute per IP
2. **Bulk sending:** 1500ms between messages (enforced server-side)
3. **Webhook timeout:** 10 seconds — keep your handler fast
4. **Phone numbers:** Always use `972XXXXXXXXX` format
5. **Media:** Prefer `mediaUrl` over `mediaBase64` for large files — the service downloads from the URL
6. **Session restore:** Always pass `"autoRestore": true` when starting a session — this ensures the session reconnects automatically after server restarts
7. **Never store API_SECRET in frontend** — proxy all API calls through the WorkMatch backend

---

## Full Flow Example

### 1. Onboarding — Connect WhatsApp Device

```
WorkMatch Frontend                    WorkMatch Backend                WhatsApp Service
      │                                     │                               │
      │  User clicks "Connect WhatsApp"     │                               │
      ├────────────────────────────────────►│                               │
      │                                     │  POST /api/sessions/wm-123/start
      │                                     │  { webhookUrl: "https://..." }│
      │                                     ├──────────────────────────────►│
      │                                     │◄─── 200 { status: connecting }│
      │                                     │                               │
      │  Open iframe: /connect/wm-123       │                               │
      │◄────────────────────────────────────│                               │
      │                                     │                               │
      │  [User scans QR with WhatsApp]      │                               │
      │                                     │                               │
      │  Poll: GET /connect/wm-123/status   │                               │
      ├─────────────────────────────────────┼──────────────────────────────►│
      │◄─────────────────────────────────── { status: connected, phone: ..} │
      │                                     │                               │
      │  ✅ Show "Connected" in UI          │  ◄── Webhook: { event: connected }
      │                                     │                               │
```

### 2. Sending a Job Alert

```javascript
// WorkMatch Backend
const response = await fetch('https://wa.otomator.pro/api/messages/send', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.WHATSAPP_API_SECRET}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    orgId: 'wm-org-123',
    to: '972501234567',
    type: 'text',
    message: `שלום דני! 👋\nיש לנו משרה חדשה שמתאימה לפרופיל שלך:\n\n📌 מפתח Full Stack\n🏢 חברת TechCo\n📍 תל אביב\n💰 25,000-35,000 ₪\n\nמעוניין? השב "כן" לפרטים נוספים`
  })
});

const { messageId } = await response.json();
```

### 3. Handling Incoming Candidate Reply

```javascript
// WorkMatch Backend — POST /api/webhooks/whatsapp
app.post('/api/webhooks/whatsapp', (req, res) => {
  const { event, orgId, from, fromName, message, messageId } = req.body;

  if (event === 'message') {
    // Process candidate reply
    console.log(`${fromName} (${from}): ${message}`);
    // Route to WorkMatch conversation handler...
  }

  if (event === 'message_status') {
    // Update delivery status in DB
    const { messageId, status, to } = req.body;
    // status: 'sent' | 'delivered' | 'read'
  }

  if (event === 'disconnected') {
    // Alert admin, show reconnect UI
  }

  // Always respond 200 quickly
  res.status(200).json({ ok: true });
});
```

---

## Health Check

```http
GET /health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "sessions": { "active": 3, "connected": 2 },
  "uptime": 86400,
  "memory": { "rss": "128MB", "heapUsed": "64MB" }
}
```

Use this to monitor service availability from WorkMatch.

---

## Quick Reference Card

| Action | Method | Endpoint | Auth |
|---|---|---|---|
| Start session | POST | `/api/sessions/:orgId/start` | ✅ |
| Session status | GET | `/api/sessions/:orgId/status` | ✅ |
| Stop session | DELETE | `/api/sessions/:orgId` | ✅ |
| Purge session | POST | `/api/sessions/:orgId/purge` | ✅ |
| List sessions | GET | `/api/sessions` | ✅ |
| Send message | POST | `/api/messages/send` | ✅ |
| Send bulk | POST | `/api/messages/send-bulk` | ✅ |
| Webhook failures | GET | `/api/sessions/:orgId/webhook-failures` | ✅ |
| Clear failures | DELETE | `/api/sessions/:orgId/webhook-failures` | ✅ |
| QR page | GET | `/connect/:orgId` | ❌ |
| Status polling | GET | `/connect/:orgId/status` | ❌ |
| Health | GET | `/health` | ❌ |
