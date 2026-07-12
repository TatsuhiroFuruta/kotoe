#!/bin/bash
set -e

# gem は名前付きボリュームに載せるため、イメージを再ビルドせずに Gemfile を
# 更新した場合はここで追従させる。
bundle check || bundle install

# 異常終了で pid ファイルが残っていると rails server が起動しない。
rm -f tmp/pids/server.pid

exec "$@"
