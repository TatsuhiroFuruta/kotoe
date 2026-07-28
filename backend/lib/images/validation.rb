module Images
  # アップロードされたファイルを受け入れてよいか判定する。
  #
  # Cloudinary もネットワークも知らない純粋な判定なので、単体で速くテストできる。
  # Images::Uploader と分けてあるのは利用者が違うため：お題画像（issue 3-2）は
  # ユーザー入力なので検証が要るが、生成画像（issue 4-2）は自前で作った PNG で
  # 検証の対象ではない。1 クラスにまとめると「検証をスキップするフラグ」が生える。
  class Validation
    MAX_BYTES = 5.megabytes

    # HEIC / HEIF は iPhone の標準形式で、Safari から生で飛んでくることがある。
    # Cloudinary 側で JPEG に変換して配信できるため受け入れる。
    ALLOWED_CONTENT_TYPES = %w[
      image/jpeg
      image/png
      image/webp
      image/heic
      image/heif
    ].freeze

    # 文言ではなくエラーコードを返す。日本語化はフロントの辞書が行う
    # （CLAUDE.md：ルールの判定はバック、見せ方はフロント）。
    Result = Data.define(:error_code) do
      def valid? = error_code.nil?
    end

    def self.call(file) = new(file).call

    def initialize(file)
      @file = file
    end

    # 最初に見つかった 1 件だけを返す（フロントの表示は 1 行のトーストで足りる）。
    # サイズを形式より先に見るのは、巨大なファイルの中身を読まずに弾くため。
    def call
      return Result.new(error_code: "image_missing") if missing?
      return Result.new(error_code: "image_too_large") if too_large?
      return Result.new(error_code: "image_type_not_allowed") unless allowed_type?

      Result.new(error_code: nil)
    end

    private

    def missing?
      @file.nil? || @file.size.to_i.zero?
    end

    def too_large?
      @file.size > MAX_BYTES
    end

    def allowed_type?
      ALLOWED_CONTENT_TYPES.include?(detected_content_type)
    end

    # クライアントが送る Content-Type とファイル名は使わない。どちらも自由に
    # 詐称できるため、ファイル先頭のマジックバイトだけで判定する。
    #
    # 呼び出し側が既に読み進めている可能性があるので、読む前に位置を戻す。
    # Marcel は読み取り後に位置を 0 に戻すため、判定後はそのまま
    # Images::Uploader へ渡せる。
    def detected_content_type
      @file.rewind
      Marcel::MimeType.for(@file)
    end
  end
end
