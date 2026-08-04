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
          file.rewind
          block.call(file)
        end
      end

      private

      def fetch_b64_image
        response = post_request

        raise_for_status(response) unless response.is_a?(Net::HTTPSuccess)

        # 応答の形が変わるのは向こう側の問題。KeyError で 500 にせず api_error に寄せる。
        JSON.parse(response.body).dig("data", 0, "b64_json") ||
          raise(Generator::PermanentError.new("api_error", detail: "no b64_json"))
      end

      def post_request
        http = Net::HTTP.new(ENDPOINT.host, ENDPOINT.port)
        http.use_ssl = true
        http.open_timeout = OPEN_TIMEOUT
        http.read_timeout = READ_TIMEOUT

        http.request(build_request)
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

      # 失敗の分類は Task 4 で実装する。
      def raise_for_status(response)
        raise Generator::PermanentError.new("api_error", detail: "status=#{response.code}")
      end
    end
  end
end
