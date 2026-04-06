📋 משימה ל-Claude Code
─────────────────────
שם: Fix truncated files, add connect page, commit and prepare for deploy
Branch: feature/production-hardening (existing branch)

## Context

Several files were truncated in a previous commit. They have been rewritten correctly.
A new QR connect page was added. The build passes with zero errors locally.

## מה לעשות:

### 1. Verify these files are complete (not truncated)

Check that each file ends properly — NOT mid-line or mid-function:

- `package.json` — must end with `}` and have both `dependencies` and `devDependencies` complete
- `Dockerfile` — must end with `CMD ["node", "dist/index.js"]`
- `src/index.ts` — must end with `setupGracefulShutdown(server)`
- `src/auth.ts` — must have complete `authMiddleware` export
- `src/types.ts` — must have complete `Session`, `MessageType`, `SendMessageRequest`, `ApiError` interfaces
- `src/routes/sessions.ts` — must have all routes: list, start, qr, status, stop, webhook-failures
- `src/routes/messages.ts` — must have send + send-bulk routes with all 7 message types
- `src/sessionManager.ts` — must have startSession, stopSession, restoreSessions, getStatus, getQR exports

If ANY file is truncated, do NOT commit. Report which files are broken.

### 2. Build

```bash
npm run build
```

Must be zero errors.

### 3. Git — stage and commit

```bash
git add src/index.ts src/auth.ts src/types.ts src/sessionManager.ts
git add src/routes/sessions.ts src/routes/messages.ts src/routes/connect.ts
git add src/lib/logger.ts src/lib/sessionStore.ts src/lib/shutdown.ts src/lib/webhookDispatcher.ts
git add src/middleware/requestId.ts src/middleware/validate.ts
git add package.json package-lock.json Dockerfile docker-compose.yml
git add CLAUDE.md PLAN.md .env.example nginx.conf setup-vps.sh ecosystem.config.js tsconfig.json .gitignore
```

Commit message:
```
feat: production-hardened WhatsApp service with QR connect page

- Fix all truncated source files (auth, types, sessions, messages, sessionManager)
- Fix truncated package.json and Dockerfile
- Add QR onboarding page at /connect/:orgId (no auth, Hebrew RTL UI)
- Add structured logging (pino), request IDs, validation (zod)
- Add webhook dispatcher with retry, graceful shutdown
- Add session auto-restore from disk
- Multi-stage Docker build
```

### 4. Report

דווח:
- האם כל הקבצים שלמים?
- האם ה-build עבר?
- מה ה-commit hash?
- מה ה-branch name?

## אל תגע ב:
- sessions/ directory
- .env file
- node_modules/

## חשוב:
- אם קובץ חתוך — עצור ודווח. אל תנסה לתקן בעצמך.
- הקבצים כבר תוקנו ע"י Cowork. רק תאמת ותעשה commit.
