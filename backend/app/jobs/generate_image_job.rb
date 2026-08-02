# 挑戦の再現画像を作るジョブ。issue 4-2 の時点では固定のダミー画像を上げるだけで、
# 本物の画像生成APIへの差し替えは 4-3（差分は「画像の出どころ」だけになる）。
class GenerateImageJob < ApplicationJob
  # lib/assets は Zeitwerk の対象外（config.autoload_lib の ignore）。
  DUMMY_IMAGE_PATH = Rails.root.join("lib/assets/dummy_generated.png")

  queue_as :default

  # 宣言順に意味がある。ActiveJob はハンドラを後勝ちで探す（rescue_handlers を
  # 逆順に走査する）ため、rescue_from(StandardError) を先に、retry_on を後に書く。
  # 逆にすると UploadError も StandardError 側に吸われ、リトライされずに failed になる。
  #
  # コードのバグ：failed にしてから再送出する。ユーザーは失敗を見られ、開発者は
  # solid_queue_failed_executions にエラーが残る。握りつぶすと attempt が永久に
  # generating のまま残り、フロントが延々ポーリングする。
  rescue_from(StandardError) do |error|
    self.class.mark_failed(arguments.first)
    raise error
  end

  # Cloudinary の一時障害：3 回まで待って試す。使い切ったら failed にするが、
  # ジョブ自体は失敗扱いにしない（外部サービスの障害はコードのバグではない）。
  retry_on Images::Uploader::UploadError, wait: :polynomially_longer, attempts: 3 do |job, _error|
    Rails.logger.warn("[GenerateImageJob] Cloudinary へのアップロードに失敗しました attempt_id=#{job.arguments.first}")
    mark_failed(job.arguments.first)
  end

  # 生成枠は戻さない（生成はジョブ enqueue 時に消費する。ドメイン規則）ので
  # generated_at には触れない。kept で絞らないのは、生成中に削除された attempt も
  # 終端状態にしておくため（generating のまま残すと状態機械が壊れる）。
  def self.mark_failed(attempt_id)
    Attempt.generating.find_by(id: attempt_id)&.update!(status: :failed)
  end

  def perform(attempt_id)
    # 冪等性はこの1行で担保する。generating の attempt しか掴まないので、
    # 生成中に削除された場合も、ジョブが二重に走った場合も、黙って何もせず終わる。
    attempt = Attempt.kept.generating.find_by(id: attempt_id)
    return if attempt.nil?

    public_id = upload_dummy_image

    attempt.update!(generated_image_public_id: public_id, status: :published)
  end

  private

  # 生成が成功したら即公開（結果を見てから公開を選ぶ導線は作らない）。
  def upload_dummy_image
    File.open(DUMMY_IMAGE_PATH, "rb") { |file| Images::Uploader.call(file, kind: :generated) }
  end
end
