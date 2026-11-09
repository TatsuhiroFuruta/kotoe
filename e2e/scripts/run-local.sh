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
# テストを始めたか。始める前に失敗したときは、画像は上がっていないので Cloudinary の後片付けを飛ばす。
TESTS_STARTED=false

cleanup() {
  # テストの終了コードを保つ。後片付けの失敗で結果を隠さず、残りの後片付けも止めない。
  # 先にサーバーを止める。backend-e2e は Puma の中で Solid Queue を動かしており、動いたままだと
  # 画像の削除の後に生成ジョブが同じフォルダへ上げ、その画像が消されずに残る。
  "${COMPOSE[@]}" stop backend-e2e frontend-e2e || true
  if [ "$TESTS_STARTED" = true ]; then
    # 止めたサービスではなく、使い捨てのコンテナで消す（同じ環境変数・同じ entrypoint）。
    # KOTOE_CLOUDINARY_FOLDER は上で export した値が compose の補間で渡る。
    "${COMPOSE[@]}" run --rm --no-deps backend-e2e bin/rails e2e:cleanup_cloudinary || true
  fi
  "${COMPOSE[@]}" rm -f backend-e2e frontend-e2e || true
  exit "$STATUS"
}
trap 'STATUS=$?; trap - EXIT; cleanup' EXIT

# 前回の実行が中断して残ったコンテナを片付けてから始める。
"${COMPOSE[@]}" rm -sf backend-e2e frontend-e2e || true

"${COMPOSE[@]}" build frontend-e2e

# DB 作り直しは --no-deps で走らせるので、db を先に起動しておく（起動済みなら何もしない）。
# 開発環境の db と同じサービスなので、止めたり作り直したりはしない。
"${COMPOSE[@]}" up -d --wait db

# DB を作り直す。backend-e2e の entrypoint（e2e/docker/backend-e2e-env.sh）が DATABASE_URL の
# DB 名を kotoe_e2e に差し替える。
# DATABASE_URL があると、development の db:drop / db:prepare は test 用 DB（kotoe_test）を
# 対象に加えない（activerecord の DatabaseTasks#each_current_environment）。
# db:prepare は db/seeds.rb も流すが、中身は空なので E2E のデータには影響しない。
"${COMPOSE[@]}" run --rm --no-deps backend-e2e bin/rails db:drop db:prepare

"${COMPOSE[@]}" up -d backend-e2e frontend-e2e

# frontend-e2e は起動のたびに next build を走らせるので、待ち時間は長めに取る。
curl --retry 150 --retry-delay 2 --retry-max-time 300 --retry-all-errors -fsS -o /dev/null http://localhost:3100/api/health
curl --retry 150 --retry-delay 2 --retry-max-time 300 --retry-all-errors -fsS -o /dev/null http://localhost:3101/

cd e2e
TESTS_STARTED=true
npx playwright test "$@"
