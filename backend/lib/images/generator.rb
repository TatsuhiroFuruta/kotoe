module Images
  # 画像生成の入口。プロバイダの選択は Task 5 で足す。
  class Generator
    # 画像生成の失敗。code はそのまま attempts.failure_reason に入る。
    #
    # リトライの可否を「型」で表す。ジョブ側の if ではなく型で分けることで、
    # ActiveJob の宣言的なハンドラ（retry_on / discard_on）にそのまま乗る。
    class Error < StandardError
      attr_reader :code

      # message に外部APIのレスポンス本文を入れない。エラー本文に鍵や個人情報が
      # 混ざりうるため（Images::Uploader が元例外のクラス名だけを残しているのと
      # 同じ理由）。プロンプト（＝ユーザーの描写文）も出さない。
      def initialize(code, detail: nil)
        @code = code
        super([ code, detail ].compact.join(" "))
      end
    end

    # 時間を置けば直る。retry_on の対象。
    class TransientError < Error; end

    # 同じ入力なら必ずまた失敗する（ポリシー違反・キー不正・残高切れ）。
    # リトライしても実費が増えるだけなので discard_on の対象にする。
    class PermanentError < Error; end
  end
end
