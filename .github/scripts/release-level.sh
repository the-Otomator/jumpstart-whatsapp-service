#!/usr/bin/env bash
# release-level classifier (see .github/workflows/release-level.yml). Canonical copy — identical in every repo.
# Env: REPO, PR, BASE, HEAD_SHA, GH_TOKEN. Optional: HEAD_REF (default HEAD), DRY_RUN=1 (print only), CONF.
# SECURITY: runs from the BASE branch (pull_request_target / nightly-merge). Rules are read from the BASE branch,
# never from the PR, so a PR cannot relax its own classification. PR code is never executed.
set -euo pipefail
CONF="${CONF:-.github/release-levels.conf}"

# ---- defaults. Per-repo $CONF lines KEY=REGEX are ADDED to these (they can only make rules stricter). ----
DOCS_RE='^(docs/|_task_tmp/|_state/|_handout/|\.cursor/|[^/]+\.md$)'
DB_RE='^(supabase/migrations/|migrations/)'
SERVER_RE='^(supabase/functions/|functions/|workers/)'
SENSITIVE_RE='^(\.github/|package(-lock)?\.json$|pnpm-lock\.yaml$|yarn\.lock$|vite\.config|index\.html$|wrangler\.toml$|public/(sw|service-worker|_headers|_redirects)|src/(App|main)\.tsx$)|/(auth|billing|payments?|checkout|subscription)[^/]*/|(auth|supabase|billing|payment)[A-Za-z]*\.(ts|tsx)$'
FRONTEND_RE='^src/'   # app screens; any other path is "unclassified" → L2
HEAD_REF="${HEAD_REF:-HEAD}"
git fetch -q origin "$BASE"
if CONF_TXT=$(git show "origin/$BASE:$CONF" 2>/dev/null); then
  while IFS='=' read -r k v; do
    case "$k" in DB_RE|SERVER_RE|SENSITIVE_RE) [ -n "$v" ] && printf -v "$k" '(%s)|(%s)' "${!k}" "$v";;
                 FRONTEND_RE) [ -n "$v" ] && FRONTEND_RE="$v";; esac
  done < <(grep -E '^[A-Z_]+=' <<<"$CONF_TXT" || true)
fi
m() { [ -n "$2" ] && grep -Eq -- "$2" <<<"$1"; }

MB=$(git merge-base "origin/$BASE" "$HEAD_REF")
mapfile -t FILES < <(git diff --name-only "$MB" "$HEAD_REF")

level=0; reasons=()
bump() { if [ "$1" -gt "$level" ]; then level=$1; fi; reasons+=("L$1: $2"); }

for f in "${FILES[@]}"; do
  [ -n "$f" ] || continue
  if [[ "$f" == .github/* ]]; then bump 2 "$f (release rules/workflows)"
  elif m "$f" "$DOCS_RE"; then continue
  elif m "$f" "$DB_RE"; then bump 4 "$f"
  elif m "$f" "$SERVER_RE"; then bump 3 "$f"
  elif m "$f" "$SENSITIVE_RE"; then bump 2 "$f"
  elif m "$f" "$FRONTEND_RE"; then bump 1 "$f"
  else bump 2 "$f (unclassified path)"
  fi
done

# ---- API check: new server names called from changed code must already be referenced on the base branch ----
if [ "$level" -eq 1 ] && [ "${#FILES[@]}" -gt 0 ]; then
  added=$(git diff -U0 "$MB" "$HEAD_REF" -- $(printf '%s\n' "${FILES[@]}" | grep -Ev "$DOCS_RE" || true) | grep -E '^\+' | grep -Ev '^\+\+\+' || true)
  names=$( { grep -oE "\.rpc\(\s*['\"][A-Za-z0-9_]+" <<<"$added" | sed -E "s/.*['\"]//;s/^/rpc:/";
             grep -oE "\.from\(\s*['\"][A-Za-z0-9_]+" <<<"$added" | sed -E "s/.*['\"]//;s/^/table:/";
             grep -oE "functions\.invoke\(\s*['\"][A-Za-z0-9_-]+" <<<"$added" | sed -E "s/.*['\"]//;s/^/function:/"; } | sort -u || true)
  for n in $names; do
    id="${n#*:}"
    if ! git grep -q -w -- "$id" "$MB" -- . >/dev/null 2>&1; then
      bump 2 "calls ${n} which the base branch never references (may not exist in production yet)"
    fi
  done
fi

case $level in 0) name="docs";; 1) name="safe-ui";; 2) name="sensitive";; 3) name="server";; 4) name="database";; esac
label="level:${level}-${name}"
desc="L${level} ${name}"
[ "${#reasons[@]}" -gt 0 ] && desc="$desc — $(printf '%s' "${reasons[0]}" | cut -c1-90)"
echo "LEVEL=$level"; echo "RESULT $label"; printf '  %s\n' "${reasons[@]:0:20}"

[ "${DRY_RUN:-}" = "1" ] && exit 0
declare -A COLORS=([0]=C5DEF5 [1]=0E8A16 [2]=FBCA04 [3]=D93F0B [4]=B60205)
for i in 0 1 2 3 4; do
  case $i in 0) n=docs;; 1) n=safe-ui;; 2) n=sensitive;; 3) n=server;; 4) n=database;; esac
  gh label create "level:${i}-${n}" --color "${COLORS[$i]}" --description "release-level (automatic)" >/dev/null 2>&1 || true
  [ "$i" != "$level" ] && gh pr edit "$PR" --remove-label "level:${i}-${n}" >/dev/null 2>&1 || true
done
gh pr edit "$PR" --add-label "$label" >/dev/null
gh api -X POST "repos/$REPO/statuses/$HEAD_SHA" -f state=success -f context=release-level -f description="${desc:0:139}" >/dev/null
{ echo "### Release level: \`$label\`"; echo; printf -- '- %s\n' "${reasons[@]:0:50}"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
