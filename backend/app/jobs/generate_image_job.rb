# 挑戦の再現画像を作るジョブ。画像の出どころは Images::Generator が決める
# （本番は OpenAI、ローカル・CI・E2E はダミー）。ここは配線と、失敗を終端状態に
# 落とすことだけを担当する。
class GenerateImageJob < ApplicationJob
  # Cloudinary の一時障害は、ジョブごと再実行せず**アップロードだけ**を再試行する。
  # 生成とアップロードは同じジョブの中にあるので、ジョブを再実行すると OpenAI の生成まで
  # やり直され、同じ 1 枠に対して実費が 3 倍かかる。画像はもう手元にあるので、
  # 上げ直すだけならタダである。
  #
  # 「1 枠 ＝ 1 生成」はコストガードの前提でもある（アプリ 50 枚/日 ＝ 月額最悪 $16.5 が
  # 前払いクレジット $20 を下回る、という3層の設計。docs/deployment.md 参照）。
  # ここが 3 倍に増幅すると最悪値が $49.5/月 になり、穏やかなガードより先に残高が尽きる。
  UPLOAD_ATTEMPTS = 3
  UPLOAD_RETRY_WAIT = 3 # 秒。spec は stub_const で 0 にする

  queue_as :default

  # 宣言順に意味がある。ActiveJob はハンドラを後勝ちで探す（rescue_handlers を
  # 逆順に走査する）ため、rescue_from(StandardError) を先に、retry_on / discard_on を
  # 後に書く。逆にすると個別の例外もすべて StandardError 側に吸われる。
  #
  # コードのバグ：failed にしてから再送出する。ユーザーは失敗を見られ、開発者は
  # solid_queue_failed_executions にエラーが残る。握りつぶすと attempt が永久に
  # generating のまま残り、フロントが延々ポーリングする。
  rescue_from(StandardError) do |error|
    self.class.mark_failed(arguments.first, "internal_error")
    raise error
  end

  # 同じ入力なら必ずまた失敗する（ポリシー違反・キー不正・残高切れ）。リトライしても
  # 実費が増えるだけなので捨てる。ジョブ自体は失敗扱いにしない（外部サービスの都合や
  # ユーザーの入力はコードのバグではない）ので、原因はログにだけ残す。
  discard_on Images::Generator::PermanentError do |job, error|
    Rails.logger.warn(
      "[GenerateImageJob] 画像生成に失敗しました（再試行しません） " \
      "attempt_id=#{job.arguments.first} error=#{error.message}"
    )
    mark_failed(job.arguments.first, error.code)
  end

  # 時間を置けば直る失敗。回数を 2 にとどめるのはコストの理由で、タイムアウトは
  # 「API が課金対象の生成を終えたのに、こちらが待ちきれなかった」場合を含むため、
  # リトライすると同じ 1 枠に二重課金になる。
  retry_on Images::Generator::TransientError, wait: :polynomially_longer, attempts: 2 do |job, error|
    Rails.logger.warn(
      "[GenerateImageJob] 画像生成に失敗しました（再試行を使い切りました） " \
      "attempt_id=#{job.arguments.first} error=#{error.message}"
    )
    mark_failed(job.arguments.first, error.code)
  end

  # ここに来るのは upload_with_retry が UPLOAD_ATTEMPTS 回とも失敗したとき。
  # ジョブは再実行しない（再実行すると生成からやり直しになり二重課金になる）。
  # ジョブ自体は失敗扱いにもしない（外部サービスの障害はコードのバグではない）。
  #
  # 原因まで残す。Images::Uploader は StandardError をすべて UploadError に包むため、
  # ここには一時障害だけでなく本番の CLOUDINARY_URL の設定漏れのような「直さない限り
  # 永久に失敗し続ける」障害も来る。solid_queue_failed_executions に残らないので、
  # このログが唯一の手がかりになる。
  # message には元例外のクラス名しか入らない（Uploader が秘密情報を落としている）。
  discard_on Images::Uploader::UploadError do |job, error|
    Rails.logger.warn(
      "[GenerateImageJob] Cloudinary へのアップロードに失敗しました " \
      "attempt_id=#{job.arguments.first} error=#{error.message}"
    )
    mark_failed(job.arguments.first, "upload_failed")
  end

  # 生成枠は戻さない（生成はジョブ enqueue 時に消費する。ドメイン規則）ので
  # generated_at には触れない。kept で絞らないのは、生成中に削除された attempt も
  # 終端状態にしておくため（generating のまま残すと状態機械が壊れる）。
  #
  # 知らない理由コードは internal_error に倒す。Attempt 側が許可値を検証しているので、
  # 素通しすると rescue ハンドラの中で RecordInvalid が出て、attempt が generating の
  # まま取り残される（フロントが延々ポーリングする、この設計で最も避けたい状態）。
  # 例外の code は Images::Generator::Error が自由文字列を許すため、ここで受け止める。
  def self.mark_failed(attempt_id, reason)
    reason = "internal_error" unless Attempt::FAILURE_REASONS.include?(reason)

    Attempt.generating.find_by(id: attempt_id)&.update!(status: :failed, failure_reason: reason)
  end

  def perform(attempt_id)
    # 冪等性はこの1行で担保する。generating の attempt しか掴まないので、
    # 生成中に削除された場合も、ジョブが二重に走った場合も、黙って何もせず終わる。
    attempt = Attempt.kept.generating.find_by(id: attempt_id)
    return if attempt.nil?

    # キルスイッチはここでも見る。Attempts::Generation の判定は enqueue 時のものなので、
    # それだけだと「止めたのにキューに残っていたぶんが走り切って課金される」。
    # 実費を今すぐ止めるのがこの switch の目的なので、実行の直前に確かめ直す。
    return self.class.mark_failed(attempt_id, "generation_disabled") unless Attempts::Generation.enabled?

    public_id = Images::Generator.call(Images::Prompt.call(attempt.description)) do |file|
      upload_with_retry(file)
    end

    # 生成が成功したら即公開（結果を見てから公開を選ぶ導線は作らない）。
    attempt.update!(generated_image_public_id: public_id, status: :published)
  end

  private

  # 生成済みの画像を上げ直すだけなので、ジョブを再実行するのと違って実費がかからない。
  # 同じ File を渡し直せるのは Images::Uploader が毎回 rewind するため。
  #
  # 待ちは同期なのでワーカースレッドを塞ぐが、最大でも UPLOAD_RETRY_WAIT × 2 秒。
  # 生成そのものが最大 150 秒かかることを思えば誤差である。
  def upload_with_retry(file)
    tries = 0

    begin
      tries += 1
      Images::Uploader.call(file, kind: :generated)
    rescue Images::Uploader::UploadError => e
      raise if tries >= UPLOAD_ATTEMPTS

      Rails.logger.warn(
        "[GenerateImageJob] Cloudinary へのアップロードを再試行します " \
        "attempt_id=#{arguments.first} try=#{tries} error=#{e.message}"
      )
      sleep(UPLOAD_RETRY_WAIT)
      retry
    end
  end
end
