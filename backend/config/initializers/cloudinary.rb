# 画像の保存先は Cloudinary。gem は CLOUDINARY_URL を自動で読み、
# cloud_name / api_key / api_secret を設定する（明示的な設定記述は不要）。
#
#   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
#
# この値は api_secret を含むためサーバー側のみに置く。フロントに渡すのは
# cloud_name だけで、これは配信URLに必ず現れる公開値（issue 3-2 で渡す）。
#
# 設定漏れは起動時に落とす。黙って起動すると「デプロイは green なのに
# 画像投稿だけが全部失敗する」状態になり、原因を追いにくいため。
# development / test は未設定のまま動かす運用なので本番のみに限定する
# （test は spec/support/cloudinary.rb が SDK をスタブするため実キーが要らない）。
#
# cors.rb と違って after_initialize を使わない。あちらは autoload される
# 定数（Cors::AllowedOrigins）を参照するため遅延させる必要があるが、
# ここは ENV を見るだけなので初期化時にそのまま評価してよい。
if ENV["CLOUDINARY_URL"].blank? && Rails.env.production?
  raise "CLOUDINARY_URL が設定されていません。Cloudinary ダッシュボードの " \
        "API Environment variable の値を設定してください。"
end
