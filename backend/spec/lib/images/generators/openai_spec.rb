require "rails_helper"

RSpec.describe Images::Generators::Openai do
  let(:image) { "fake-webp-binary".b }
  let(:success_body) { { data: [ { b64_json: Base64.strict_encode64(image) } ] }.to_json }

  # ENV の差し替えは spec/lib/attempts/generation_spec.rb と同じ手を使う。
  before do
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:fetch).with("OPENAI_API_KEY").and_return("sk-test")
  end

  def stub_generation(status: 200, body: nil)
    stub_request(:post, "https://api.openai.com/v1/images/generations")
      .to_return(status: status, body: body, headers: { "Content-Type" => "application/json" })
  end

  describe ".call" do
    it "デコードした画像を、先頭から読める File として yield する" do
      stub_generation(body: success_body)

      read = nil
      described_class.call("空の絵") { |file| read = file.read }

      expect(read).to eq(image)
    end

    it "ブロックの戻り値をそのまま返す" do
      stub_generation(body: success_body)

      expect(described_class.call("空の絵") { "kotoe/test/generated/x" }).to eq("kotoe/test/generated/x")
    end

    # ジョブが ensure で後始末する責任を負わずに済むよう、ブロック形式で必ず消す。
    it "ブロックを抜けたら一時ファイルを消す" do
      stub_generation(body: success_body)

      path = described_class.call("空の絵", &:path)

      expect(File.exist?(path)).to be(false)
    end

    # 確定値。勝手に変えるとコストと出力品質が変わる（設計ドキュメント参照）。
    it "モデル・サイズ・品質・出力形式・圧縮率・moderation を指定して送る" do
      stub_generation(body: success_body)

      described_class.call("空の絵") { nil }

      expect(WebMock).to have_requested(:post, "https://api.openai.com/v1/images/generations")
        .with(
          headers: { "Authorization" => "Bearer sk-test", "Content-Type" => "application/json" },
          body: {
            model: "gpt-image-2",
            prompt: "空の絵",
            size: "1024x1024",
            quality: "low",
            output_format: "webp",
            output_compression: 90,
            moderation: "auto",
            n: 1
          }
        )
    end
  end

  describe "失敗の分類" do
    def call_and_capture
      described_class.call("空の絵") { nil }
      nil
    rescue Images::Generator::Error => e
      e
    end

    # 同じ描写文なら必ずまた弾かれるので、リトライしない。
    it "400 のポリシー違反は PermanentError の content_policy" do
      stub_generation(status: 400, body: { error: { code: "content_policy_violation" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("content_policy")
    end

    it "400 の moderation_blocked も content_policy として扱う" do
      stub_generation(status: 400, body: { error: { code: "moderation_blocked" } }.to_json)

      expect(call_and_capture.code).to eq("content_policy")
    end

    # 実際の error.code / error.type の文字列は本番スモークで採取するまで確定できない。
    # 認識できない値は api_error に倒し、想定外のコードで落ちないようにする。
    it "400 の未知のコードは PermanentError の api_error" do
      stub_generation(status: 400, body: { error: { code: "something_new" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    it "401 は PermanentError の api_error（直さない限り永久に失敗する）" do
      stub_generation(status: 401, body: { error: { code: "invalid_api_key" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    it "429 のレート制限は TransientError の rate_limited" do
      stub_generation(status: 429, body: { error: { type: "requests" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::TransientError)
      expect(error.code).to eq("rate_limited")
    end

    # 前払いクレジットが尽きた状態。待っても直らないのでリトライしない。
    it "429 の insufficient_quota は PermanentError の api_error" do
      stub_generation(status: 429, body: { error: { type: "insufficient_quota" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    it "500 は TransientError の api_error" do
      stub_generation(status: 500, body: "")

      error = call_and_capture

      expect(error).to be_a(Images::Generator::TransientError)
      expect(error.code).to eq("api_error")
    end

    it "503 は TransientError の api_error" do
      stub_generation(status: 503, body: "")

      expect(call_and_capture).to be_a(Images::Generator::TransientError)
    end

    # 接続が確立する前の失敗は課金されていないので、再試行してよい。
    it "接続タイムアウトは TransientError の api_error" do
      stub_request(:post, "https://api.openai.com/v1/images/generations").to_timeout

      error = call_and_capture

      expect(error).to be_a(Images::Generator::TransientError)
      expect(error.code).to eq("api_error")
    end

    # DNS 障害は SocketError で、IOError でも SystemCallError でもない（どちらも
    # StandardError の直下）。取りこぼすとジョブが internal_error 扱いで終わり、
    # 再試行されないまま生成枠だけが消える。
    it "DNS 障害（SocketError）は TransientError の api_error" do
      stub_request(:post, "https://api.openai.com/v1/images/generations")
        .to_raise(SocketError.new("getaddrinfo: Name or service not known"))

      error = call_and_capture

      expect(error).to be_a(Images::Generator::TransientError)
      expect(error.code).to eq("api_error")
    end

    it "壊れた応答（Net::HTTPBadResponse）は TransientError の api_error" do
      stub_request(:post, "https://api.openai.com/v1/images/generations")
        .to_raise(Net::HTTPBadResponse)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::TransientError)
      expect(error.code).to eq("api_error")
    end

    # 読み取りタイムアウトは「リクエストが受理され、生成が完了して課金された」場合を
    # 含む。ここを再試行すると同じ 1 枠に二重課金になり、「1 枠 ＝ 1 生成」を前提に
    # した3層のコストガード（アプリ 50枚/日 ＝ 月額最悪 $16.5 < 前払い $20）が崩れる。
    it "読み取りタイムアウトは再試行しない（PermanentError）" do
      stub_request(:post, "https://api.openai.com/v1/images/generations")
        .to_raise(Net::ReadTimeout)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    # 成功側にも JSON のガードが要る。エラー側（extract_error）だけ守っても、
    # 200 でプロキシの HTML が返れば JSON::ParserError が素通りして internal_error になる。
    it "200 でも本文が JSON でなければ PermanentError の api_error" do
      stub_generation(body: "<html>OK</html>")

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    it "200 でも本文が配列なら PermanentError の api_error" do
      stub_generation(body: "[]")

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    # プロキシの HTML エラーページなど、JSON でない本文が返ることがある。
    # 分類できないだけなので落とさず api_error に倒す。
    it "本文が JSON でなくても落ちずに分類する" do
      stub_generation(status: 400, body: "<html>Bad Request</html>")

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    it "200 でも b64_json が無ければ PermanentError の api_error" do
      stub_generation(body: { data: [] }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    # レスポンス本文には鍵や個人情報が混ざりうる。プロンプトはユーザーの描写文そのもの。
    it "例外メッセージにレスポンス本文とプロンプトを含めない" do
      stub_generation(status: 400, body: { error: { code: "x", message: "secret-detail" } }.to_json)

      expect(call_and_capture.message).not_to include("secret-detail")
      expect(call_and_capture.message).not_to include("空の絵")
    end
  end
end
