# 画像生成APIのキー（issue 4-3）。api_secret と同じくサーバー側のみに置き、
# フロントには絶対に出さない。
#
# 設定漏れは起動時に落とす。黙って起動すると「デプロイは green なのに生成だけが
# 全部 failed になる」状態になり、しかも生成枠は戻らないのでユーザーが枠を溶かす。
# config/initializers/cloudinary.rb と同じ方針。
#
# 実APIを使う設定のときだけ見る（ローカル・CI はダミーなのでキーが要らない）。
#
# after_initialize を使うのは、autoload される定数（Images::Generator）を参照するため
# （config/initializers/cors.rb と同じ理由）。
Rails.application.config.after_initialize do
  if Images::Generator.provider_name == "openai" && ENV["OPENAI_API_KEY"].blank?
    raise "OPENAI_API_KEY が設定されていません。実APIを使わない場合は " \
          "KOTOE_IMAGE_PROVIDER=dummy を設定してください。"
  end
end
