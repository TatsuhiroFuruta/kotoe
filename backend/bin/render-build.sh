#!/usr/bin/env bash
# Render のビルドフェーズで実行される。gem 導入と DB マイグレーションを行う。
# API モードのためアセットのプリコンパイルは無い。
set -o errexit

bundle install
bundle exec rails db:migrate
