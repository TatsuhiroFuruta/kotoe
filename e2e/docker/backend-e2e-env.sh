#!/bin/sh
# docker-compose.yml の backend-e2e の entrypoint。
# DATABASE_URL の DB 名だけを kotoe_e2e に差し替えてから、渡されたコマンドを実行する
# （config/database.yml の test が kotoe_test に差し替えるのと同じ置換）。
# サーバーの起動も、run-local.sh の DB の作り直し・後片付けも、ここを通る。
# DATABASE_URL が無い、または scheme://authority/DB名[?query] の形でないときは、
# 開発の DB に向かないよう、何も実行せずに止める。
set -eu

URL_FORM='^[A-Za-z][A-Za-z0-9+.-]*://[^/]+/[^/?]+(\?.*)?$'

if [ -z "${DATABASE_URL:-}" ]; then
  echo "backend-e2e: DATABASE_URL が設定されていません" >&2
  exit 1
fi
if ! printf '%s' "$DATABASE_URL" | grep -Eq "$URL_FORM"; then
  echo "backend-e2e: DATABASE_URL に DB 名がありません（scheme://host/DB名 の形にしてください）" >&2
  exit 1
fi

DATABASE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*://[^/]+)/[^/?]+#\1/kotoe_e2e#')"
export DATABASE_URL

exec "$@"
