module Api
  # 【一時】issue 3-1 の本番疎通確認用。
  #
  # Render の free プランは Shell / one-off job が使えないため、本番で
  # Cloudinary のキーが通ることを確かめる手段が HTTP しかない。
  # 本番で 1 回叩いて確認したら、このファイルとルートを削除する
  # （8-2a の /smoke を #54 で追加 → #56 で削除したのと同じ扱い）。
  class SmokeController < ApplicationController
    before_action :authenticate_user!

    # 1x1 の透明 PNG。spec/fixtures はテスト用の置き場なのでアプリコードから
    # 参照せず、ここにバイト列で持つ。Base64 は Rails 自身が依存している。
    ONE_PIXEL_PNG = Base64.decode64(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" \
      "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    ).freeze

    def cloudinary
      file = png_tempfile

      render json: { public_id: Images::Uploader.call(file, kind: :post) }
    rescue Images::Uploader::UploadError => e
      render json: { error: e.message }, status: :bad_gateway
    ensure
      file&.close!
    end

    private

    def png_tempfile
      Tempfile.new([ "smoke", ".png" ]).tap do |tempfile|
        tempfile.binmode
        tempfile.write(ONE_PIXEL_PNG)
        tempfile.rewind
      end
    end
  end
end
