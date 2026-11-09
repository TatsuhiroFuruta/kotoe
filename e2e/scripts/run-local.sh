#!/usr/bin/env bash
# ローカルで E2E を 1 本のコマンドで回す。
#   DB（kotoe_e2e）の作り直し → backend-e2e / frontend-e2e の起動 → Playwright → 後片付け
# 開発環境（docker compose up の backend / frontend / worker / DB kotoe_development）には触れない。
# 使い方: e2e/scripts/run-local.sh [playwright test の引数...]
set -euo pipefail

cd "$(dirname "$0")/../.."

# この実行で Cloudinary に上げた画像の保存先。後片付けでこの接頭辞の下だけを消す。
export KOTOE_CLOUDINARY_FOLDER="kotoe/e2e/local-$(date +%s)"

COMPOSE=(docker compose --profile e2e)
STATUS=0

cleanup() {
  # テストの終了コードを保つ。後片付けの失敗で結果を隠さず、残りの後片付けも止めない。
  "${COMPOSE[@]}" exec -T backend-e2e bin/rails e2e:cleanup_cloudinary || true
  "${COMPOSE[@]}" stop backend-e2e frontend-e2e || true
  "${COMPOSE[@]}" rm -f backend-e2e frontend-e2e || true
  exit "$STATUS"
}
trap 'STATUS=$?; trap - EXIT; cleanup' EXIT

"${COMPOSE[@]}" build frontend-e2e

# DB を作り直す（config/database.yml の test と同じ、DB 名だけを kotoe_e2e に差し替える置換）。
# db:prepare は db/seeds.rb も流すが、中身は空なので E2E のデータには影響しない。
"${COMPOSE[@]}" run --rm --no-deps backend-e2e sh -c '
  export DATABASE_URL="$(printf "%s" "$DATABASE_URL" | sed -E "s#/[^/?]+(\?|\$)#/kotoe_e2e\1#")"
  # development では db:drop / db:prepare が test 用 DB（kotoe_test）にも及ぶため外す。
  SKIP_TEST_DATABASE=true bin/rails db:drop db:prepare
'

"${COMPOSE[@]}" up -d backend-e2e frontend-e2e

curl --retry 60 --retry-delay 2 --retry-all-errors -fsS -o /dev/null http://localhost:3100/api/health
curl --retry 60 --retry-delay 2 --retry-all-errors -fsS -o /dev/null http://localhost:3101/

cd e2e
npx playwright test "$@"
