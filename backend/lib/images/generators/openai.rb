require "net/http"
require "base64"

module Images
  module Generators
    # OpenAI の画像生成API（POST /v1/images/generations）を叩き、生成された画像を
    # File として yield する。
    #
    # 公式 gem を使わないのは、Stainless 生成の SDK が全エンドポイントぶんのコードを
    # 読み込むため（本番の余裕は 37 MB しかない。docs/README.md の「Render 無料枠の
    # メモリ実測」参照）。使うのはこのエンドポイント 1 本だけ。
    class Openai
      ENDPOINT = URI("https://api.openai.com/v1/images/generations").freeze

      # 環境変数にしない。コストと出力品質を左右するプロダクトの判断なので、
      # 変更が PR として履歴に残るべきもの。
      MODEL = "gpt-image-2"
      SIZE = "1024x1024"
      QUALITY = "low"           # 1024x1024 で約 $0.006/枚
      OUTPUT_FORMAT = "webp"    # PNG だとピーク 5〜7 MB。WebP で 1〜2 MB に収まる
      OUTPUT_COMPRESSION = 90   # 将来のダウンロード導線を見据えて画質側に寄せた値
      MODERATION = "auto"       # 公開UGCなので緩めない

      # 実際に返る文字列は本番スモークで採取して確定させる。認識できない値は
      # api_error に倒れるので、取りこぼしてもジョブは壊れない。
      CONTENT_POLICY_CODES = %w[content_policy_violation moderation_blocked].freeze
      INSUFFICIENT_QUOTA = "insufficient_quota"

      OPEN_TIMEOUT = 10
      # 「複雑なプロンプトで最大2分」（公式ドキュメント）。短くすると、生成は済んで
      # 課金もされたのに待ちきれず、リトライで同じ1枠に二重課金することになる。
      READ_TIMEOUT = 150

      def self.call(prompt, &block) = new(prompt).call(&block)

      def initialize(prompt)
        @prompt = prompt
      end

      # @yieldparam [File] 読み出し位置が先頭の画像ファイル。ブロックを抜けると消える
      # @return [Object] ブロックの戻り値（ジョブは Cloudinary の public_id を受け取る）
      def call(&block)
        image = Base64.decode64(fetch_b64_image)

        # ディスクに落とすのは、デコード後のバイナリを、Cloudinary が multipart 本文を
        # 組み立てる前に Ruby のヒープから解放するため。ブロック形式なので消し忘れない。
        Tempfile.create([ "kotoe-generated", ".webp" ], binmode: true) do |file|
          file.write(image)
          # 参照を切らないと image がブロックの間ずっと生き、アップロード（と最大3回の
          # 再試行）のあいだ multipart 本文と同時にヒープに載る。上の意図が果たされない。
          image = nil
          file.rewind
          block.call(file)
        end
      end

      private

      def fetch_b64_image
        response = post_request

        raise_for_status(response) unless response.is_a?(Net::HTTPSuccess)

        extract_b64(response) ||
          raise(Generator::PermanentError.new("api_error", detail: "no b64_json"))
      end

      # 応答の形が変わるのは向こう側の問題。200 でもプロキシの HTML ページが返ったり
      # 想定外の構造だったりしうるので、500 にせず api_error に寄せる
      # （エラー側の extract_error と同じ扱いを成功側にも置く）。
      def extract_b64(response)
        parsed = JSON.parse(response.body)
        data = parsed.is_a?(Hash) ? parsed["data"] : nil
        first = data.is_a?(Array) ? data.first : nil

        first.is_a?(Hash) ? first["b64_json"] : nil
      rescue JSON::ParserError
        nil
      end

      # 例外クラスは失敗の種類（DNS・接続・読み取り・SSL）で変わるので、呼び出し側が
      # 1 つ rescue すれば済むようここで一本化する。
      #
      # 分ける基準は「課金されたかどうか」。接続が確立する前に落ちたものは実費が
      # 発生していないので再試行してよい。SocketError（DNS 障害）と
      # Net::HTTPBadResponse は IOError でも SystemCallError でもなく StandardError の
      # 直下なので、名指ししないと取りこぼしてジョブが internal_error で終わる。
      def post_request
        http = Net::HTTP.new(ENDPOINT.host, ENDPOINT.port)
        http.use_ssl = true
        http.open_timeout = OPEN_TIMEOUT
        http.read_timeout = READ_TIMEOUT

        http.request(build_request)
      rescue Net::ReadTimeout => e
        # 読み取りタイムアウトは「リクエストが受理され、生成が完了して課金された」場合を
        # 含む。再試行すると同じ 1 枠に二重課金になり、「1 枠 ＝ 1 生成」を前提にした
        # 3層のコストガードが崩れる（月額最悪 $16.5 が $33 になり前払い $20 を超える）。
        # Timeout::Error より先に書く必要がある（Net::ReadTimeout はその子）。
        raise Generator::PermanentError.new("api_error", detail: e.class.name)
      rescue Timeout::Error, IOError, SystemCallError, SocketError,
             OpenSSL::SSL::SSLError, Net::HTTPBadResponse => e
        raise Generator::TransientError.new("api_error", detail: e.class.name)
      end

      def build_request
        # ローカル変数に置くのは、文字列補間の中でシングルクォートを使わずに済ませるため
        # （プロジェクトの規約はダブルクォート統一）。
        api_key = ENV.fetch("OPENAI_API_KEY")

        request = Net::HTTP::Post.new(ENDPOINT)
        request["Authorization"] = "Bearer #{api_key}"
        request["Content-Type"] = "application/json"
        request.body = JSON.generate(
          model: MODEL,
          prompt: @prompt,
          size: SIZE,
          quality: QUALITY,
          output_format: OUTPUT_FORMAT,
          output_compression: OUTPUT_COMPRESSION,
          moderation: MODERATION,
          n: 1
        )
        request
      end

      # 分類の根拠は設計ドキュメントの「エラーの分類」表。
      def raise_for_status(response)
        status = response.code.to_i

        raise build_error(status, extract_error(response))
      end

      def build_error(status, error)
        detail = "status=#{status}"

        return Generator::PermanentError.new("content_policy", detail: detail) if content_policy?(status, error)
        return Generator::PermanentError.new("api_error", detail: detail) if quota_exhausted?(status, error)
        return Generator::TransientError.new("rate_limited", detail: detail) if status == 429
        return Generator::TransientError.new("api_error", detail: detail) if status >= 500

        Generator::PermanentError.new("api_error", detail: detail)
      end

      def content_policy?(status, error)
        status == 400 && CONTENT_POLICY_CODES.include?(error["code"])
      end

      def quota_exhausted?(status, error)
        status == 429 && error["type"] == INSUFFICIENT_QUOTA
      end

      # 本文が JSON でない（プロキシの HTML エラーページ等）ことも、error が
      # ハッシュでないこともある。分類できないだけなので落とさず空として扱う。
      def extract_error(response)
        parsed = JSON.parse(response.body)
        error = parsed.is_a?(Hash) ? parsed["error"] : nil

        error.is_a?(Hash) ? error : {}
      rescue JSON::ParserError, TypeError
        {}
      end
    end
  end
end
