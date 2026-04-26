import { Router, Request, Response } from 'express';
import { logger } from '../lib/logger.js';

const router = Router();

// GET /api/globalmax/dialup
// Query params (forwarded as-is to Globalmax):
//   user, pass, org, dial1, dial2, SetCID, Response
//
// Auth: Bearer API_SECRET (handled by parent middleware on /api/*).
//
// Response: pass-through of Globalmax body + status code.
const GLOBALMAX_HOST = process.env.GLOBALMAX_HOST ?? 'voip1.globalex.co.il';

const REQUIRED = ['user', 'pass', 'org', 'dial1', 'dial2', 'SetCID'] as const;

router.get('/dialup', async (req: Request, res: Response) => {
  // Validate required params
  for (const key of REQUIRED) {
    if (typeof req.query[key] !== 'string' || !(req.query[key] as string).trim()) {
      return res.status(400).json({ error: `missing or empty query param: ${key}` });
    }
  }

  // Build target URL preserving order/encoding
  const url = new URL(`https://${GLOBALMAX_HOST}/API/dialup.php`);
  for (const key of REQUIRED) {
    url.searchParams.set(key, String(req.query[key]));
  }
  url.searchParams.set('Response', String(req.query.Response ?? 'yes'));

  const reqId = req.headers['x-request-id'] ?? '-';
  logger.info({ reqId, dial1: req.query.dial1, dial2: req.query.dial2, setCid: req.query.SetCID }, 'globalmax-dialup-proxy:start');

  try {
    const upstream = await fetch(url.toString(), { method: 'GET' });
    const body = await upstream.text();
    logger.info({ reqId, status: upstream.status, ok: /Response:\s*OK/i.test(body) }, 'globalmax-dialup-proxy:done');
    res.status(upstream.status)
      .type(upstream.headers.get('content-type') ?? 'text/html; charset=utf-8')
      .send(body);
  } catch (err) {
    logger.error({ reqId, err: String(err) }, 'globalmax-dialup-proxy:upstream-error');
    res.status(502).json({ error: 'upstream_unreachable', detail: String((err as Error)?.message ?? err) });
  }
});

export default router;
