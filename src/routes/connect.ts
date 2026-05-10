import { Router, Request, Response } from 'express'
import { getQR, getStatus, startSession, stopSession } from '../sessionManager'
import { orgLogger } from '../lib/logger'
import { validateOrg } from '../lib/supabase'

const router = Router()

/**
 * GET /connect/:orgId/status (JSON)
 * Polled by the connect page to get live status + QR.
 * Registered before `/:orgId` so paths like `/uuid/status` never match a greedy `:orgId`.
 */
router.get('/:orgId/status', (req: Request, res: Response) => {
  const { orgId } = req.params
  const session = getStatus(orgId)
  if (!session) {
    res.json({ status: 'not_found' })
    return
  }
  res.json({
    status: session.status,
    phoneNumber: session.phoneNumber,
    qr: session.status === 'qr' ? session.qr : undefined,
  })
})

/**
 * GET /connect/:orgId
 * Self-contained QR onboarding page.
 * No auth -- this is a one-time setup link shared with the client.
 * In production, protect with a short-lived token or restrict to admin portal.
 */
router.get('/:orgId', async (req: Request, res: Response) => {
  const { orgId } = req.params
  const log = orgLogger(orgId)

  const orgCheck = await validateOrg(orgId)
  if (!orgCheck.valid) {
    res.status(403).send(renderErrorPage(orgId, 'No active subscription for this org'))
    return
  }

  // Auto-start session if not running or disconnected.
  // For disconnected sessions: purge stale creds first so a fresh QR is always generated.
  const status = getStatus(orgId)
  if (!status || status.status === 'disconnected') {
    log.info({ prevStatus: status?.status ?? 'none' }, 'Auto-starting session from connect page')
    try {
      if (status?.status === 'disconnected') {
        stopSession(orgId, { purgeAuthDir: true })
        await new Promise((r) => setTimeout(r, 500))
      }
      await startSession(orgId)
    } catch (err) {
      log.error({ err }, 'Failed to auto-start session from connect page')
    }
  }

  res.send(renderConnectPage(orgId))
})

function renderConnectPage(orgId: string): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Connection</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #fafafa;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #141414; border: 1px solid #2a2a2a; border-radius: 16px;
      padding: 40px; max-width: 440px; width: 90%; text-align: center;
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
    .org-badge {
      display: inline-block; background: #1a2a1a; color: #4ade80;
      padding: 4px 12px; border-radius: 20px; font-size: 13px;
      font-family: monospace; margin-bottom: 24px;
    }
    .state { display: none; }
    .state.active { display: block; }
    .qr-container {
      background: #fff; border-radius: 12px; padding: 16px;
      display: inline-block; margin: 16px 0;
    }
    .qr-container img { width: 256px; height: 256px; display: block; }
    .connected-icon { font-size: 64px; margin: 16px 0; }
    .phone-number {
      font-size: 20px; font-weight: 600; color: #4ade80;
      font-family: monospace; direction: ltr;
    }
    .spinner {
      width: 48px; height: 48px; border: 3px solid #333;
      border-top-color: #4ade80; border-radius: 50%;
      animation: spin 0.8s linear infinite; margin: 24px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .steps {
      text-align: right; margin: 20px 0 0; padding: 20px;
      background: #1a1a1a; border-radius: 8px;
      font-size: 14px; line-height: 2; color: #aaa;
    }
    .steps strong { color: #fafafa; }
    .retry-btn {
      background: #4ade80; color: #000; border: none;
      padding: 10px 24px; border-radius: 8px; font-size: 14px;
      font-weight: 600; cursor: pointer; margin-top: 16px;
    }
    .retry-btn:hover { background: #22c55e; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">&#128242;</div>
    <h1>Connect WhatsApp</h1>
    <div class="org-badge">${orgId}</div>

    <div id="state-loading" class="state active">
      <div class="spinner"></div>
      <p style="color:#888;">Connecting to service...</p>
    </div>

    <div id="state-qr" class="state">
      <div class="qr-container">
        <img id="qr-image" src="" alt="QR Code">
      </div>
      <div class="steps">
        <strong>Steps:</strong><br>
        1. Open WhatsApp on your phone<br>
        2. Tap <strong>Linked Devices</strong><br>
        3. Tap <strong>Link a Device</strong><br>
        4. Scan the code
      </div>
    </div>

    <div id="state-connecting" class="state">
      <div class="spinner"></div>
      <p style="color:#888;">Connecting... waiting for authentication</p>
    </div>

    <div id="state-connected" class="state">
      <div class="connected-icon">&#9989;</div>
      <h2 style="margin-bottom:8px;">Connected!</h2>
      <p class="phone-number" id="phone-display"></p>
      <p style="color:#888;margin-top:12px;font-size:14px;">
        WhatsApp connected successfully. You can close this page.
      </p>
    </div>

    <div id="state-disconnected" class="state">
      <div class="connected-icon">&#9888;&#65039;</div>
      <h2 style="margin-bottom:8px;">Disconnected</h2>
      <p style="color:#888;font-size:14px;">Connection lost. Click to retry.</p>
      <button class="retry-btn" onclick="location.reload()">Retry</button>
    </div>

    <div id="state-not_found" class="state">
      <div class="connected-icon">&#10067;</div>
      <h2 style="margin-bottom:8px;">Not found</h2>
      <p style="color:#888;font-size:14px;">Session does not exist. Click to start.</p>
      <button class="retry-btn" onclick="location.reload()">Start connection</button>
    </div>
  </div>

  <script>
    var orgId = '${orgId}';
    var currentState = 'loading';
    var pollInterval;
    var notFoundCount = 0;

    function setState(state) {
      if (state === currentState) return;
      currentState = state;
      document.querySelectorAll('.state').forEach(function(el) { el.classList.remove('active'); });
      var el = document.getElementById('state-' + state);
      if (el) el.classList.add('active');
    }

    function poll() {
      fetch('/connect/' + orgId + '/status')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          switch (data.status) {
            case 'qr':
              notFoundCount = 0;
              setState('qr');
              if (data.qr) document.getElementById('qr-image').src = data.qr;
              break;
            case 'connecting':
              notFoundCount = 0;
              setState('connecting');
              break;
            case 'connected':
              notFoundCount = 0;
              setState('connected');
              var phone = data.phoneNumber || '';
              document.getElementById('phone-display').textContent = '+' + phone;
              clearInterval(pollInterval);
              break;
            case 'disconnected':
              setState('disconnected');
              clearInterval(pollInterval);
              break;
            case 'not_found':
              notFoundCount++;
              if (notFoundCount > 7) { setState('not_found'); clearInterval(pollInterval); }
              break;
          }
        })
        .catch(function(err) { console.error('Poll error:', err); });
    }

    setTimeout(function() {
      poll();
      pollInterval = setInterval(poll, 2000);
    }, 1500);
  </script>
</body>
</html>`
}

function renderErrorPage(orgId: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #fafafa;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #141414; border: 1px solid #2a2a2a; border-radius: 16px;
      padding: 40px; max-width: 440px; width: 90%; text-align: center;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
    p { color: #888; font-size: 14px; margin-bottom: 20px; }
    .cta {
      display: inline-block; background: #4ade80; color: #000;
      text-decoration: none; padding: 10px 24px; border-radius: 8px;
      font-size: 14px; font-weight: 600;
    }
    .cta:hover { background: #22c55e; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128683;</div>
    <h1>${message}</h1>
    <p>To use WhatsApp service, please subscribe first.</p>
    <a class="cta" href="https://hub.jumpstart.co.il">Subscribe</a>
  </div>
</body>
</html>`
}

export default router
