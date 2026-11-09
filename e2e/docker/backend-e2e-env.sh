#!/bin/sh
# docker-compose.yml の backend-e2e の entrypoint。
# DATABASE_URL の DB 名だけを kotoe_e2e に差し替えてから、渡されたコマンドを実行する
# （config/database.yml の test が kotoe_test に差し替えるのと同じ置換）。
# サーバーの起動も、run-local.sh の DB の作り直し・後片付けも、ここを通る。
set -eu

DATABASE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#/[^/?]+(\?|$)#/kotoe_e2e\1#')"
export DATABASE_URL

exec "$@"
