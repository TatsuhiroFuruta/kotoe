# Cloudinary は外部サービス。spec が実際にネットワークへ出ないよう、
# SDK のアップロードを全 spec で既定スタブ化する。
#
# 個々の spec の書き手がスタブを書き忘れても本物を叩かない、という保証を
# 仕組みで作るのが狙い。あわせて issue 3-2 以降の request spec / job spec が
# 毎回スタブを書かずに済む。
#
# 実際の契約（キーが通るか・レスポンス形状が想定どおりか）はスタブでは
# 守れないので、そこは本番スモークで担保する（設計ドキュメント参照）。
#
# 渡す引数や戻り値そのものを検証したい spec（spec/lib/images/uploader_spec.rb）は
# この既定スタブを自分で上書きする。
RSpec.configure do |config|
  config.before do
    allow(Cloudinary::Uploader).to receive(:upload).and_return(
      "public_id" => "kotoe/test/posts/stubbed"
    )
  end
end
