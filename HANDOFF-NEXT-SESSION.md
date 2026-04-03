# Handoff — Next Session
**תאריך:** 2026-04-03
**מצב:** VPS אחרי reboot. שירות WhatsApp לא רץ. Admin Portal מראה "Service unreachable".

---

## מה קרה עד כה

1. ✅ קוד הסקריפט `reset-and-harden.sh` נכתב ב-Cowork ונדחף ל-git ב-branch `feature/supabase-org-validation` (commit `e3ad353`)
2. ✅ `docker-compose.yml` תוקן — port binding ל-`127.0.0.1` בלבד (אבטחה)
3. ✅ `nginx.conf` עודכן עם domain אמיתי + HTTPS redirect + security headers
4. ✅ VPS ביצע `apt upgrade` + `reboot`
5. ❌ **הבעיה:** ה-VPS ביצע `git reset --hard origin/feature/production-hardening` לפני ה-reboot — ה-branch הישן, בלי הסקריפט ובלי תיקון ה-docker-compose
6. ❌ Docker container אולי לא עלה אחרי ה-reboot (צריך לבדוק)

---

## מה צריך לעשות — לפי סדר עדיפויות

### 1. הרם את השירות על ה-VPS (SSH ידני)

```bash
ssh root@147.93.127.180

# עבור ל-branch הנכון (עם כל ה-fixes)
cd /opt/whatsapp-service
git fetch origin
git checkout feature/supabase-org-validation
git reset --hard origin/feature/supabase-org-validation

# ודא שהסקריפט קיים
ls reset-and-harden.sh

# הרץ את ה-reset המלא
chmod +x reset-and-harden.sh
bash reset-and-harden.sh
```

אחרי הריצה — בדוק:
```bash
curl -s https://wa.otomator.pro/health
# צפוי: {"status":"ok","sessions":1,"uptime":...}
```

---

### 2. בדוק למה Admin Portal מראה "Service unreachable"

ה-Admin Portal מתחבר ל-WhatsApp Service דרך **Supabase Edge Function** בשם `whatsapp-proxy`.
הפרוקסי מעביר קריאות ל-`https://wa.otomator.pro` עם `WHATSAPP_API_SECRET`.

**בדוק אם הסוד מוגדר ב-Supabase:**
- פתח: https://app.supabase.com/project/mzalzjtsyrjycaxolldv/settings/functions
- ודא ש-`WHATSAPP_API_SECRET` מוגדר עם הערך הנכון: `00b5c06e2cf219d11c3e599acd564726`

אם הסוד לא מוגדר — זו הסיבה ל-"Service unreachable".

---

### 3. Cloudflare Pages — לא צריך deploy

לא בוצעו שינויים ב-`otomator-admin` בסשן הזה.
ה-deploy האחרון ("a day ago") עדיין תקף.
אין מה לדפלוי.

---

### 4. אחרי שהשירות עלה — הגדר SSH key לאוטומציה עתידית

```bash
# על ה-VPS:
mkdir -p ~/.ssh
echo "PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

זה יאפשר ל-Claude Code לבצע deploys ישירות בלי להצטרך SSH ידני.

---

## מצב הענפים בגיט

| Branch | Commit | תוכן |
|--------|--------|------|
| `feature/supabase-org-validation` | `e3ad353` | **הכי עדכני** — Supabase validation + reset script + nginx fix |
| `feature/production-hardening` | `c960302` | ישן — בלי reset script |
| `main` | — | לא מעודכן |

**ה-VPS צריך להיות על `feature/supabase-org-validation`**

---

## קבצים רלוונטיים

- `reset-and-harden.sh` — סקריפט ל-VPS reset נקי
- `docker-compose.yml` — port binding ל-127.0.0.1
- `nginx.conf` — config מלא עם SSL
- `TASK-1-supabase-integration.md` — validation כבר implemented
- `HANDOFF-B-client-portal.md` — הצעד הבא: WhatsApp module ב-JumpStart Hub (לא התחיל)
