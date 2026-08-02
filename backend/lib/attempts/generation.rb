module Attempts
  # 生成の起動。上限チェック → status 更新 → enqueue を、ひとまとまりで行う。
  #
  # コントローラに置かないのは、この3つが「必ず一緒に起きる」ことに意味があるため
  # （4-1 の設計「トランザクションの一体性」）。コントローラは Result を HTTP に
  # 翻訳するだけにする。文言ではなくエラーコードを返す（i18n はフロント）。
  class Generation
    DEFAULT_DAILY_LIMIT = 3

    Result = Data.define(:error_code, :limit) do
      def ok? = error_code.nil?
    end

    def self.call(attempt) = new(attempt).call

    # ENV はクラス本体ではなくここで読む。定数に畳むと起動時の値で固まり、
    # spec から差し替えられない。
    #
    # 正の整数でなければ既定値に落とす。"".to_i も "abc".to_i も 0 なので、
    # 素直に to_i すると「ダッシュボードで環境変数を空にした」だけで全ユーザーの生成が
    # 止まる。しかも応答は枠を使い切ったときと同じ 422 で、原因の切り分けができない。
    def self.daily_limit
      configured = ENV.fetch("KOTOE_DAILY_GENERATION_LIMIT", DEFAULT_DAILY_LIMIT).to_i

      configured.positive? ? configured : DEFAULT_DAILY_LIMIT
    end

    def initialize(attempt)
      @attempt = attempt
    end

    def call
      # DB を書かない判定なのでロックの外で済ませる。
      return Result.new(error_code: "attempt_not_draft", limit: nil) unless @attempt.draft?

      # with_lock は users の行に SELECT ... FOR UPDATE を張り、そのままトランザクションになる。
      #
      # 1. ロックが無いと、連打や2タブからの同時リクエストが上限チェックを2つとも通過し、
      #    枠を超えて課金が発生する（4-3 以降は実費）。範囲は1ユーザーの行だけなので
      #    他のユーザーは待たない。
      # 2. status の更新と enqueue が同じトランザクションに入る。ジョブテーブルが
      #    アプリと同じ DB にあるため、ロールバックすればジョブ行も一緒に消えて
      #    孤児ジョブが出ない（ActiveJob::Base.enqueue_after_transaction_commit は
      #    false のまま変えないこと）。
      # 3. ブロックの戻り値がそのまま返るので、break や return でトランザクションを
      #    抜ける必要がない。
      @attempt.user.with_lock { start_generation }
    end

    private

    def start_generation
      # ロックを取ってから draft を確かめ直す。ロックの外の判定だけだと、二重送信
      # （ボタン連打・2タブ）で両方が「まだ draft」を読んでから順にロックへ入り、
      # 2 本目も通ってしまう。枠は 1 回しか減っていないのに同じ attempt に対して
      # ジョブが 2 本積まれ、4-3 以降は実費の生成が 2 回走ることになる。
      return Result.new(error_code: "attempt_not_draft", limit: nil) unless @attempt.reload.draft?

      limit = self.class.daily_limit
      return Result.new(error_code: "generation_limit_reached", limit: limit) if used_today >= limit

      @attempt.update!(status: :generating, generated_at: Time.current)
      GenerateImageJob.perform_later(@attempt.id)

      Result.new(error_code: nil, limit: nil)
    end

    # discard は default_scope を張らないため user.attempts には削除済みも含まれる。
    # それが狙いどおりで、「削除しても回数は戻さない」がクエリの形で満たされる。
    # 「1日」は JST の暦日（config.time_zone = "Asia/Tokyo"）。
    def used_today
      @attempt.user.attempts.where(generated_at: Time.zone.now.all_day).count
    end
  end
end
