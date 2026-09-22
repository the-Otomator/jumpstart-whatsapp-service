/**
 * Unit tests: JumpStart license path on jumpstartSupabase + validation alerts + 503 copy.
 * Run: npx ts-node --transpile-only src/lib/validateOrg.test.ts
 */
import assert from 'assert'
import { validateOrg, type OrgValidationClient } from './supabase'
import {
  __setValidationAlertSendForTests,
  extractValidationErrorCode,
  getOrgValidationFailures,
  recordOrgValidationFailure,
  resetOrgValidationAlertStateForTests,
} from './validationAlert'
import { renderErrorPage } from '../routes/connect'
import * as waDeviceMonitor from './waDeviceMonitor'

type TableResult = { data: unknown; error: { message: string } | null }

function mockClient(tableMap: Record<string, TableResult | (() => TableResult)>): OrgValidationClient {
  return {
    from(table: string) {
      const chain: {
        select: () => typeof chain
        eq: () => typeof chain
        maybeSingle: () => Promise<TableResult>
      } = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          const entry = tableMap[table]
          if (!entry) return { data: null, error: null }
          return typeof entry === 'function' ? entry() : entry
        },
      }
      return chain
    },
  }
}

async function testJumpstartLicenseOnly(): Promise<void> {
  const orgId = 'c3aa7a0d-461a-4ed4-882a-58bd063b1e62'
  const hub = mockClient({
    whatsapp_devices: { data: null, error: null },
    central_subscriptions: { data: null, error: null },
    partner_org_slots: { data: null, error: null },
  })
  const jumpstart = mockClient({
    org_system_subscriptions: {
      data: { plan_code: 'command', metadata: {} },
      error: null,
    },
    system_license_plans: {
      data: { features: { whatsapp_devices_included: 2 } },
      error: null,
    },
  })

  const result = await validateOrg(orgId, { hub, jumpstart })
  assert.strictEqual(result.valid, true)
  assert.strictEqual(result.unavailable, undefined)
  assert.strictEqual(result.plan, 'jumpstart/command')
}

async function testJumpstartErrorAlertsOnce(): Promise<void> {
  resetOrgValidationAlertStateForTests()
  const originalAlerts = process.env.WA_SESSION_ALERTS
  const originalThrottle = process.env.WA_VALIDATION_ALERT_MS
  process.env.WA_SESSION_ALERTS = '1'
  process.env.WA_VALIDATION_ALERT_MS = '1800000'

  let alertCalls = 0
  const originalResolve = waDeviceMonitor.resolveAlertSender
  ;(waDeviceMonitor as { resolveAlertSender: typeof originalResolve }).resolveAlertSender =
    async () => 'alert-sender-session'

  __setValidationAlertSendForTests(async () => {
    alertCalls += 1
  })

  try {
    const hub = mockClient({
      whatsapp_devices: { data: null, error: null },
      central_subscriptions: { data: null, error: null },
      partner_org_slots: { data: null, error: null },
    })
    const jumpstart = mockClient({
      org_system_subscriptions: {
        data: null,
        error: { message: 'relation "org_system_subscriptions" does not exist' },
      },
    })

    const first = await validateOrg('org-fail-1', { hub, jumpstart })
    assert.strictEqual(first.valid, false)
    assert.strictEqual(first.unavailable, true)
    assert.strictEqual(alertCalls, 1)
    assert.strictEqual(getOrgValidationFailures(), 1)

    const second = await validateOrg('org-fail-1', { hub, jumpstart })
    assert.strictEqual(second.unavailable, true)
    assert.strictEqual(alertCalls, 1, 'second failure within throttle window must not re-alert')
    assert.strictEqual(getOrgValidationFailures(), 2)
    assert.strictEqual(
      extractValidationErrorCode('SYSTEM_SUBSCRIPTION_LOOKUP_FAILED: boom'),
      'SYSTEM_SUBSCRIPTION_LOOKUP_FAILED'
    )
  } finally {
    ;(waDeviceMonitor as { resolveAlertSender: typeof originalResolve }).resolveAlertSender =
      originalResolve
    if (originalAlerts === undefined) delete process.env.WA_SESSION_ALERTS
    else process.env.WA_SESSION_ALERTS = originalAlerts
    if (originalThrottle === undefined) delete process.env.WA_VALIDATION_ALERT_MS
    else process.env.WA_VALIDATION_ALERT_MS = originalThrottle
    resetOrgValidationAlertStateForTests()
  }
}

function test503PageHasNoSubscribe(): void {
  const html = renderErrorPage(
    'org-x',
    'Temporary system error — the team has been notified. Try again in a few minutes.',
    { variant: 'unavailable' }
  )
  assert.ok(!/subscribe/i.test(html), '503 unavailable page must not mention subscribe')
  assert.ok(!html.includes('hub.jumpstart.co.il'), '503 unavailable page must not show Subscribe CTA')
  assert.ok(html.includes('Temporary system error'))

  const forbidden = renderErrorPage('org-x', 'No active subscription for this org', {
    variant: 'forbidden',
  })
  assert.ok(/subscribe/i.test(forbidden), '403 page must keep subscribe CTA')
}

async function main(): Promise<void> {
  // Warm the counter path without sending (alerts off).
  process.env.WA_SESSION_ALERTS = '0'
  await recordOrgValidationFailure('warmup', 'SUPABASE_NOT_CONFIGURED')
  resetOrgValidationAlertStateForTests()

  await testJumpstartLicenseOnly()
  await testJumpstartErrorAlertsOnce()
  test503PageHasNoSubscribe()
  console.log('validateOrg.test.ts: JumpStart license, alert throttle, and 503 copy passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
