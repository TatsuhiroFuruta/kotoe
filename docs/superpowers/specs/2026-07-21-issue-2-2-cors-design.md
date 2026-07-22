# issue 2-2 CORS 設定（JWT 対応）設計

- 対象 issue: [#10](https://github.com/TatsuhiroFuruta/kotoe/issues/10)（backlog 2-2、マイルストーン2：認証）
- 依存: 2-1
- ブランチ: `feature/issue-2-2-cors`
- 完了条件: Next.js（別オリジン）から認証APIを叩けて JWT を受け取れる。

## 目的

Vercel（フロント）と Render（バック）は別オリジンのため、ブラウザからの API 呼び出しには CORS の許可が要る。2-1 で発行できるようになった JWT はレスポンスの `Authorization` ヘッダに乗るが、別オリジンでは `Access-Control-Expose-Headers` がないと JavaScript から読み取れない。ここでその露出設定を入れ、あわせて本番・プレビューのオリジンを許可できる仕組みを用意する。

この issue が通ると 8-2a（本番スケルトン）は「環境変数に実値を入れて疎通を見る」だけの作業になる。

## スコープの前提と方針

`rack-cors` の導入と `CORS_ALLOWED_ORIGINS` の環境変数化は **0-3 で実施済み**。ローカルの疎通（`localhost:3001` → `localhost:3000`）に必要だったため先に入れてある。この issue では JWT と本番向けの設定を詰める。

以下は後続 issue の担当なので作らない。

- 本番オリジンの**実値の投入**と本番URLでの疎通確認 … 8-2a。ここでは `.env.example` にプレースホルダとコメントを書くまで。
- フロントの JWT 保存・付与 … 7-1。この issue はサーバーが JWT を読み取れる状態にするところまで。

### 決定事項（設計判断）

1. **判定ロジックを PORO に切り出し、`lib/` に置く**。`Cors::AllowedOrigins` に「許可するか」の判定を持たせ、`config/initializers/cors.rb` は委譲するだけにする。切り出す理由は下の「なぜ切り出すか」、`lib/` を選ぶ理由は同節の置き場所の項を参照。
2. **固定リスト＋正規表現の2本立て**。本番ドメインは完全一致の固定リスト、Vercel のプレビューURL（デプロイごとに変わる）は正規表現で許可する。CLAUDE.md の「以降 Vercel のプレビューURLを本番バックエンドに向けて継続検証する」方針は、固定リストだけでは回らない。
3. **正規表現のアンカーは実装側で強制する。ただし非キャプチャグループで囲む必要がある**。設定者が書き忘れても事故らないようにする。理由は「セキュリティ上のガード」を参照。

   当初この設計は `Regexp.new("\\A#{pattern}\\z")` としていたが、これは**誤りだった**（最終レビューで検出）。Ruby では `|` の優先順位が最も低いため、`|` を含むパターンを渡すと `\A` が最初の枝、`\z` が最後の枝にしか掛からず、中間の枝と外側の枝の片端が無アンカーになる。実測では、パターン `https://kotoe-[a-z0-9-]+-team\.vercel\.app|https://staging\.kotoe\.example\.com` に対して `https://kotoe-abc-team.vercel.app.attacker.test`（第三者が取得可能な実在しうるドメイン）が**許可されてしまう**。

   「プレビューURL と ステージング を1本で」という用途で `|` を使うのは自然な発想であり、しかもドキュメントが「アンカーは実装側で付ける」と保証しているため、設定者は守られていると信じたまま穴を開けることになる。正しくは `Regexp.new("\\A(?:#{pattern})\\z")`。
4. **`credentials: true` は設定しない**。cookie は共有せず JWT を Authorization ヘッダで運ぶ方針（CLAUDE.md）のため不要。付ける必要のない許可は付けない。
5. **設定の異常は起動時に落とす。ただし `after_initialize` で行う**。壊れた設定のままデプロイが通り、本番で全リクエストが CORS エラーになる方が原因を追いにくい。なお `config/initializers/cors.rb` の本体から直接 `Cors::AllowedOrigins` を参照することは**できない**（initializer の実行時点では Zeitwerk の autoloader が未設定で `uninitialized constant Cors` になる。実機で確認済み）。`Rails.application.config.after_initialize` の中なら autoload が効き、例外を出せば boot が中断される。

   落とす対象は2種類ある。当初は**不正な正規表現**しか想定していなかったが、これは起きにくい方だった（最終レビューで指摘）。より起きやすいのは **`CORS_ALLOWED_ORIGINS` の未設定・変数名のタイプミス**で、この場合は正常に起動したうえで全ブラウザリクエストを拒否する。8-2a で Render のダッシュボードに設定する際に最も踏みやすく、「デプロイは成功しているのにフロントだけ繋がらない」という最もデバッグしづらい症状になる。そのため `Cors::AllowedOrigins#configured?`（固定リストか正規表現の少なくとも一方があるか）を見て、**production で何も設定されていなければ boot を止める**。

   この判定は **production 限定**にする。test / CI は環境変数が未設定のまま走るのが正常なので、無条件に raise するとスイートが壊れる。
6. **CLAUDE.md のテスト規約に `spec/lib` を追記する**。現在の規約は spec の置き場所として `spec/models` / `spec/requests` / `spec/jobs` を挙げており、`lib/` 配下の spec が想定に入っていない。この PR で 1 行足して実態と合わせる。

## 構成

### Cors::AllowedOrigins（新規／`lib/cors/allowed_origins.rb`）

```ruby
module Cors
  class AllowedOrigins
    def self.current              # ENV 由来のインスタンス（メモ化）
    def self.from_env(env = ENV)  # ENV → インスタンス
    def initialize(origins:, pattern: nil)
    def allow?(origin)            # 完全一致 or 正規表現マッチ
    def configured?               # 固定リストか正規表現の少なくとも一方があるか
  end
end
```

- `initialize` は値を引数で受け取る。ENV を読むのは `from_env` の 1 メソッドだけに閉じる。
- `origins` は正規化する：`strip` → 空要素を除去 → 末尾の `/` を除去。Origin ヘッダは仕様上 `scheme://host[:port]` でパスを含まないが、設定ミスで `https://example.com/` と書かれても意図どおり動くようにする。
- `pattern` が `nil` または空文字なら正規表現によるマッチは行わない（完全一致のみ）。
- 置き場所は `lib/cors/allowed_origins.rb`。`config.autoload_lib(ignore: %w[assets tasks])` が設定済み（`config/application.rb`）なので autoload される。`app/models/` は現状 Kotoe のドメイン（User / Post / Attempt / Like / Favorite / Report）だけが並んでおり、環境変数の解釈というインフラ寄りの処理はそこに混ぜない。

#### なぜ切り出すか

`Rack::Cors` のミドルウェアは**起動時に一度だけ**設定を読む。現在の `spec/requests/cors_spec.rb` はそのため ENV を差し替えられず、`CORS_ALLOWED_ORIGINS` が未設定なら `skip` する作りになっている。正規表現マッチが加わると判定の分岐が増えるので、この状態のままだと「緩いパターンで第三者の Vercel プロジェクトを許可してしまわないか」という**今回いちばん検証したい性質がテストで守れない**。

判定を PORO に出し、initializer からは `origins` にブロックを渡してリクエストごとに委譲する形にすれば、判定ロジックは引数だけで網羅テストでき、request spec からは `Cors::AllowedOrigins.current` をスタブして任意の設定を再現できる。`skip` は不要になる。

### config/initializers/cors.rb（書き換え）

```ruby
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins { |source, _env| Cors::AllowedOrigins.current.allow?(source) }

    resource "*",
      headers: :any,
      expose: [ "Authorization" ],
      methods: [ :get, :post, :put, :patch, :delete, :options, :head ]
  end
end


# 設定の異常は起動時に落とす。initializer 本体からは autoload が効かないため
# after_initialize で参照する。
#
# 1. 不正な正規表現 … current の評価時に RegexpError で落ちる
# 2. 許可オリジンが空 … production のみ raise（test/CI は未設定が正常なため）
Rails.application.config.after_initialize do
  allowed = Cors::AllowedOrigins.current

  if Rails.env.production? && !allowed.configured?
    raise "CORS_ALLOWED_ORIGINS も CORS_ALLOWED_ORIGIN_REGEX も設定されていません"
  end
end
```

- `expose: ["Authorization"]` が本 issue の主目的。これがないと、別オリジンのフロントは 2-1 で発行された JWT をレスポンスヘッダから読み取れない。
- `origins` にブロックを渡すのは `rack-cors` の標準機能。リクエストごとに評価されるため、`current` の差し替えがそのまま効く。
- preflight（`OPTIONS`）は `rack-cors` が自動で処理するので個別のルートは書かない。
- `max_age` は既定値のままにする（現時点で調整する理由がない）。

## 環境変数

| 変数 | 用途 |
|---|---|
| `CORS_ALLOWED_ORIGINS` | カンマ区切りの**完全一致**リスト。ローカルの `http://localhost:3001`、本番ドメイン。 |
| `CORS_ALLOWED_ORIGIN_REGEX` | Vercel プレビュー用のパターン 1 本。未設定なら誰にもマッチしない。 |

`.env.example` にはプレースホルダとコメントのみを書く（実際のチーム slug は書かない）。

```
# Vercel のプレビューURLはデプロイごとに変わるため正規表現で許可する。
# チーム slug まで含めること（"kotoe-" だけで絞ると第三者が作った
# 同名プレフィックスのプロジェクトを許可してしまう）。
# 前後の \A \z は実装側で付けるので不要。
# CORS_ALLOWED_ORIGIN_REGEX=https://kotoe-[a-z0-9-]+-<your-team-slug>\.vercel\.app
```

実値の投入は 8-2a。**この issue でも 8-2a でも `backend/` のコードは変更しない**（環境変数を設定するだけで本番オリジンを許可できる、というのがこの設計の狙い）。

## セキュリティ上のガード

**アンカーを実装側で付ける。** 受け取った文字列を `\A` と `\z` で囲んでからコンパイルする。Ruby の `^` / `$` は行頭・行末にマッチするため、素で使うと改行を含む値で意図しないマッチが起きうる。設定者に書かせるのではなく実装で保証する。

**囲むときは非キャプチャグループを挟む。** `\A#{pattern}\z` では不十分で、`\A(?:#{pattern})\z` にする。`|` の優先順位が最も低いため、前者ではパターンに `|` が含まれた瞬間にアンカーが両端の枝にしか掛からなくなる（詳細は決定事項3）。ここを外すと、**ドキュメントで保証したはずの防御が、設定者にはそう見えないまま失われる**のが最も危険な点。

**チーム slug を含めることを前提にする。** `https://kotoe-[a-z0-9-]+\.vercel\.app` のようなパターンでは、第三者が `kotoe-evil` という名前で Vercel プロジェクトを作るだけで許可されてしまう。`.env.example` のコメントで明示し、この性質を spec でも固定する。

**ワイルドカード（`*`）は使わない。** 0-3 からの方針を維持する。

## テスト

### spec/lib/cors/allowed_origins_spec.rb（新規）

判定ロジックの網羅。ENV には触れず、`new(origins:, pattern:)` に直接値を渡す。

- 完全一致リストに含まれるオリジンを許可する
- リストにないオリジンを拒否する
- 正規表現にマッチするプレビューURLを許可する
- `pattern` 未設定なら完全一致のみで判定する
- チーム slug を含むパターンで `https://kotoe-evil.vercel.app` を拒否する
- アンカーなしのパターンを渡しても部分一致で通り抜けない（`pattern` に `https://kotoe\.example\.com` を渡したとき、`https://kotoe.example.com.evil.test` を拒否する）
- 末尾に `/` を含む設定値を正規化して扱う
- `from_env` が ENV の値からインスタンスを組み立てる

### spec/requests/cors_spec.rb（既存を書き換え）

`Cors::AllowedOrigins.current` をスタブして `skip` を外す。

- 許可オリジンから `POST /api/auth/sign_in` すると `Access-Control-Allow-Origin` が返り、`Access-Control-Expose-Headers` に `Authorization` が含まれ、`Authorization` ヘッダに JWT が乗る（＝完了条件そのもの）
- preflight（`OPTIONS` に `Origin` と `Access-Control-Request-Method` を付与）が成功し、`Access-Control-Allow-Methods` が返る
- 許可していないオリジンには `Access-Control-Allow-Origin` を返さない
- 正規表現で許可されたプレビューオリジンからのリクエストが通る

## 完了条件の確認方法

1. `bundle exec rspec` / `bundle exec rubocop` が green。
2. ローカルで `docker compose up` し、Next.js（`localhost:3001`）からログインして、レスポンスの `Authorization` ヘッダを JavaScript から読み取れることをブラウザで確認する。

本番URLでの疎通確認は 8-2a で行う。
