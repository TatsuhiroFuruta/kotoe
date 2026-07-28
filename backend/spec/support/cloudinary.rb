# Cloudinary は外部サービス。spec が実際にネットワークへ出ないよう、全 spec で塞ぐ。
#
# ここで守りたいのは「個々の spec の書き手がスタブを書き忘れても本物を叩かない」こと。
# docker compose は RAILS_ENV に関係なく backend/.env.development を渡すため、
# spec 実行中も SDK には本番と同じ実キーが設定されている（CI は未設定なので安全）。
# 共有アカウントなので、うっかり destroy を呼ぶと本番の資産を消しうる。
#
# 二段構えにしてある：
#   1. call_api … Cloudinary::Uploader の HTTP 出口。upload / destroy / rename /
#      upload_large など 13 個の公開メソッドがここを通る。呼ばれたら即座に落として
#      気づけるようにする。素通りして偽のデータを返すより、うるさく失敗する方がよい。
#   2. upload  … 最も使う経路なので、毎回書かなくて済むよう既定値を返す。
#      issue 3-2 以降の request spec / job spec はこれに乗る。
#
# 実際の契約（キーが通るか・レスポンス形状が想定どおりか）はスタブでは守れない。
# そこは本番スモークで担保する（設計ドキュメント参照）。
#
# 引数や戻り値そのものを検証したい spec（spec/lib/images/uploader_spec.rb）は
# 既定スタブを自分で上書きする。
RSpec.configure do |config|
  config.before do
    allow(Cloudinary::Uploader).to receive(:call_api).and_raise(
      "spec が Cloudinary の実 API を叩こうとしました。呼び出すメソッドを明示的にスタブしてください。"
    )

    # public_id は保存先フォルダから導出する。固定値にすると、生成画像（kind: :generated）を
    # 保存する issue 4-2 の spec が posts のパスを保存したまま green になってしまう。
    allow(Cloudinary::Uploader).to receive(:upload) do |_file, options|
      { "public_id" => "#{options[:folder]}/stubbed" }
    end
  end
end
