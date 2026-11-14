module E2e
  # E2E が Cloudinary に上げた画像を、実行ごとの接頭辞で消す。
  #
  # 共有アカウントなので、消してよいのは kotoe/e2e/<実行ID> の配下だけ。
  # それ以外（kotoe/production など）は API を呼ばずに ArgumentError にする。
  class CloudinaryCleanup
    # 上げる側の Images::Uploader::E2E_FOLDER と同じ形だが、わざと参照せずに別に持つ。
    # 削除の許可範囲が、アップロードの規則を緩めたときに一緒に広がらないようにするため。
    ALLOWED_PREFIX = %r{\Akotoe/e2e/[A-Za-z0-9_-]+\z}
    # Cloudinary は 1 回で最大 1000 件。partial の間は next_cursor で続ける。
    # 想定外の応答で無限ループしないよう、回数に上限を置く。
    MAX_PAGES = 100

    def self.call(prefix) = new(prefix).call

    def initialize(prefix)
      @prefix = prefix.to_s
    end

    # @return [Integer] 消した件数
    def call
      raise ArgumentError, "削除できない接頭辞です" unless ALLOWED_PREFIX.match?(@prefix)

      total = 0
      options = { resource_type: "image" }
      MAX_PAGES.times do
        # 末尾の / で kotoe/e2e/run-10 を run-1 の削除に巻き込まない。
        response = Cloudinary::Api.delete_resources_by_prefix("#{@prefix}/", **options)
        total += (response["deleted"] || {}).count { |_id, status| status == "deleted" }
        cursor = response["next_cursor"]
        break unless response["partial"] && cursor.present?

        options = options.merge(next_cursor: cursor)
      end
      total
    end
  end
end
