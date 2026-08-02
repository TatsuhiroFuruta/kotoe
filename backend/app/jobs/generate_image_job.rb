# 挑戦の再現画像を作るジョブ。issue 4-2 の時点では固定のダミー画像を上げるだけで、
# 本物の画像生成APIへの差し替えは 4-3（差分は「画像の出どころ」だけになる）。
class GenerateImageJob < ApplicationJob
  # lib/assets は Zeitwerk の対象外（config.autoload_lib の ignore）。
  DUMMY_IMAGE_PATH = Rails.root.join("lib/assets/dummy_generated.png")

  queue_as :default

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
