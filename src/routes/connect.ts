import { Router, Request, Response } from 'express'
import { getQR, getStatus, startSession } from '../sessionManager'
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
 * No auth — this is a one-time setup link shared with the client.
 * In production, protect with a short-lived token or restrict to admin portal.
 */
router.get('/:orgId', async (req: Request, res: Response) => {
  const { orgId } = req.params
  const log = orgLogger(orgId)

  const orgCheck = await validateOrg(orgId)
  if (!orgCheck.valid) {
    res.status(403).send(renderErrorPage(orgId, 'אין מנוי פעיל לארגון זה'))
    return
  }

  // Auto-start session if not already running
  const status = getStatus(orgId)
  if (!status) {
    log.info('Auto-starting session from connect page')
    try {
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
  <title>חיבור WhatsApp — ${orgId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 40px;
      max-width: 440px;
      width: 90%;
      text-align: center;
    }
    .logo {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #888;
      font-size: 14px;
      margin-bottom: 32px;
    }
    .org-badge {
      display: inline-block;
      background: #1a2a1a;
      color: #4ade80;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-family: monospace;
      margin-bottom: 24px;
    }

    /* States */
    .state { display: none; }
    .state.active { display: block; }

    /* QR */
    .qr-container {
      background: #fff;
      border-radius: 12px;
      padding: 16px;
      display: inline-block;
      margin: 16px 0;
    }
    .qr-container img {
      width: 256px;
      height: 256px;
      display: block;
    }

    /* Connected */
    .connected-icon {
      font-size: 64px;
      margin: 16px 0;
    }
    .phone-number {
      font-size: 20px;
      font-weight: 600;
      color: #4ade80;
      font-family: monospace;
      direction: ltr;
    }

    /* Loading */
    .spinner {
      width: 48px;
      height: 48px;
      border: 3px solid #333;
      border-top-color: #4ade80;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 24px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .steps {
      text-align: right;
      margin: 20px 0 0;
      padding: 20px;
      background: #1a1a1a;
      border-radius: 8px;
      font-size: 14px;
      line-height: 2;
      color: #aaa;
    }
    .steps strong { color: #fafafa; }

    .retry-btn {
      background: #4ade80;
      color: #000;
      border: none;
      padding: 10px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 16px;
    }
    .retry-btn:hover { background: #22c55e; }

    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-left: 8px;
    }
    .status-dot.green { background: #4ade80; }
    .status-dot.yellow { background: #facc15; }
    .status-dot.red { background: #f87171; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">📱</div>
    <h1>חיבור WhatsApp</h1>
    <div class="org-badge">${orgId}</div>

    <!-- Loading state -->
    <div id="state-loading" class="state active">
      <div class="spinner"></div>
      <p style="color: #888;">מתחבר לשירות...</p>
    </div>

    <!-- QR state -->
    <div id="state-qr" class="state">
      <div class="qr-container">
        <img id="qr-image" src="" alt="QR Code">
      </div>
      <div class="steps">
        <strong>שלבים:</strong><br>
        1. פתח את WhatsApp בטלפון<br>
        2. לחץ על <strong>התקנים מקושרים</strong><br>
        3. לחץ על <strong>קשר התקן</strong><br>
        4. סרוק את הקוד
      </div>
    </div>

    <!-- Connecting state (after QR scanned) -->
    <div id="state-connecting" class="state">
      <div class="spinner"></div>
      <p style="color: #888;">מתחבר... ממתין לאימות</p>
    </div>

    <!-- Connected state -->
    <div id="state-connected" class="state">
      <div class="connected-icon">✅</div>
      <h2 style="margin-bottom: 8px;">מחובר!</h2>
      <p class="phone-number" id="phone-display"></p>
      <p style="color: #888; margin-top: 12px; font-size: 14px;">
        WhatsApp מחובר בהצלחה. אפשר לסגור את העמוד.
      </p>
    </div>

    <!-- Disconnected state -->
    <div id="state-disconnected" class="state">
      <div class="connected-icon">⚠️</div>
      <h2 style="margin-bottom: 8px;">מנותק</h2>
      <p style="color: #888; font-size: 14px;">החיבור נותק. לחץ לנסות שוב.</p>
      <button class="retry-btn" onclick="location.reload()">נסה שוב</button>
    </div>

    <!-- Not found state -->
    <div id="state-not_found" class="state">
      <div class="connected-icon">❓</div>
      <h2 style="margin-bottom: 8px;">לא נמצא</h2>
      <p style="color: #888; font-size: 14px;">Session לא קיים. לחץ להתחיל.</p>
      <button class="retry-btn" onclick="location.reload()">התחל חיבור</button>
    </div>
  </div>

  <script>
    const orgId = '${orgId}';
    let currentState = 'loading';
    let pollInterval;
    let notFoundCount = 0;

    function setState(state) {
      if (state === currentState) return;
      currentState = state;
      document.querySelectorAll('.state').forEach(el => el.classList.remove('active'));
      const el = document.getElementById('state-' + state);
      if (el) el.classList.add('active');
    }

    async function poll() {
      try {
        const res = await fetch('/connect/' + orgId + '/status');
        const data = await res.json();

        switch (data.status) {
          case 'qr':
            notFoundCount = 0;
            setState('qr');
            if (data.qr) {
              document.getElementById('qr-image').src = data.qr;
            }
            break;
          case 'connecting':
            notFoundCount = 0;
            setState('connecting');
            break;
          case 'connected':
            notFoundCount = 0;
            setState('connected');
            const phone = data.phoneNumber || '';
            document.getElementById('phone-display').textContent =
              '+' + phone.replace(/(\\d{3})(\\d{2})(\\d{3})(\\d{4})/, '$1-$2-$3-$4');
            clearInterval(pollInterval);
            break;
          case 'disconnected':
            setState('disconnected');
            clearInterval(pollInterval);
            break;
          case 'not_found':
            // Keep polling for up to 15s — session may still be initializing
            notFoundCount++;
            if (notFoundCount > 7) {
              setState('not_found');
              clearInterval(pollInterval);
            }
            break;
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }

    // Small delay before first poll to let session initialize
    setTimeout(() => {
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
  <title>שגיאה — ${orgId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #fafafa; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #141414; border: 1px solid #2a2a2a; border-radius: 16px; padding: 40px; max-width: 440px; width: 90%; text-align: center; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
    p { color: #888; font-size: 14px; margin-bottom: 20px; }
    .cta {
      display: inline-block;
      background: #4ade80;
      color: #000;
      text-decoration: none;
      padding: 10px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
    }
    .cta:hover { background: #22c55e; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚫</div>
    <h1>${message}</h1>
    <p>כדי להשתמש בשירות WhatsApp, יש להירשם תחילה.</p>
    <a class="cta" href="https://hub.jumpstart.co.il">הרשם לשירות</a>
  </div>
</body>
</html>`
}

export default router
