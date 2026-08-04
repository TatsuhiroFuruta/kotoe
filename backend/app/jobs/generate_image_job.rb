# 挑戦の再現画像を作るジョブ。画像の出どころは Images::Generator が決める
# （本番は OpenAI、ローカル・CI・E2E はダミー）。ここは配線と、失敗を終端状態に
# 落とすことだけを担当する。
class GenerateImageJob < ApplicationJob
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

  # Cloudinary の一時障害：3 回まで待って試す（失敗しても実費が出ないため生成側より多い）。
  # 使い切ったら failed にするが、ジョブ自体は失敗扱いにしない（外部サービスの障害は
  # コードのバグではない）。
  # 原因まで残す。Images::Uploader は StandardError をすべて UploadError に包むため、
  # ここには一時障害だけでなく本番の CLOUDINARY_URL の設定漏れのような「直さない限り
  # 永久に失敗し続ける」障害も来る。ジョブ自体は成功扱いで
  # solid_queue_failed_executions に残らないので、このログが唯一の手がかりになる。
  # message には元例外のクラス名しか入らない（Uploader が秘密情報を落としている）。
  retry_on Images::Uploader::UploadError, wait: :polynomially_longer, attempts: 3 do |job, error|
    Rails.logger.warn(
      "[GenerateImageJob] Cloudinary へのアップロードに失敗しました " \
      "attempt_id=#{job.arguments.first} error=#{error.message}"
    )
    mark_failed(job.arguments.first, "upload_failed")
  end

  # 生成枠は戻さない（生成はジョブ enqueue 時に消費する。ドメイン規則）ので
  # generated_at には触れない。kept で絞らないのは、生成中に削除された attempt も
  # 終端状態にしておくため（generating のまま残すと状態機械が壊れる）。
  def self.mark_failed(attempt_id, reason)
    Attempt.generating.find_by(id: attempt_id)&.update!(status: :failed, failure_reason: reason)
  end

  def perform(attempt_id)
    # 冪等性はこの1行で担保する。generating の attempt しか掴まないので、
    # 生成中に削除された場合も、ジョブが二重に走った場合も、黙って何もせず終わる。
    attempt = Attempt.kept.generating.find_by(id: attempt_id)
    return if attempt.nil?

    public_id = Images::Generator.call(Images::Prompt.call(attempt.description)) do |file|
      Images::Uploader.call(file, kind: :generated)
    end

    # 生成が成功したら即公開（結果を見てから公開を選ぶ導線は作らない）。
    attempt.update!(generated_image_public_id: public_id, status: :published)
  end
end
