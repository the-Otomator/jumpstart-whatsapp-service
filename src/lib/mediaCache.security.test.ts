/**
 * Security: path-segment validation rejects traversal for media routes.
 * Run: npx ts-node --transpile-only src/lib/mediaCache.security.test.ts
 */
import { isSafePathSegment, resolveMediaFile } from './mediaCache'

let failed = 0

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg)
    failed += 1
  } else {
    console.log('PASS:', msg)
  }
}

// orgId traversal attempts
const badOrg = ['../', '..\\', '..', 'foo/../bar', 'a/b', 'a\\b', '', 'x' + '/'.repeat(2)]
for (const v of badOrg) {
  assert(!isSafePathSegment(v), `isSafePathSegment rejects orgId ${JSON.stringify(v)}`)
}

// messageId traversal attempts
const badMsg = ['../etc/passwd', '..%2f', 'foo/bar', 'a\\b', 'msg id']
for (const v of badMsg) {
  assert(!isSafePathSegment(v), `isSafePathSegment rejects messageId ${JSON.stringify(v)}`)
}

// Valid shapes (uuid-like org + baileys-like id)
assert(isSafePathSegment('c3aa7a0d-461a-4ed4-882a-58bd063b1e62'), 'accepts uuid orgId')
assert(isSafePathSegment('3EB0ABC123def'), 'accepts baileys-like messageId')

// resolveMediaFile must not touch fs for bad segments
assert(resolveMediaFile('../', 'x') === null, 'resolveMediaFile null for bad orgId ../')
assert(resolveMediaFile('org', '../secret') === null, 'resolveMediaFile null for bad messageId ../')
assert(resolveMediaFile('org/../etc', 'msg') === null, 'resolveMediaFile null for org path slash')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll media path security checks passed')
