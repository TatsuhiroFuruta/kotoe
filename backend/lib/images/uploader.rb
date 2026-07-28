module Images
  # 画像を Cloudinary へ上げて public_id を返す。
  #
  # 受け入れ判定（サイズ・形式）は Images::Validation の担当で、ここには無い。
  # 生成画像（issue 4-2）は自前で作った PNG なので検証を通さずにここだけを使う。
  class Uploader
    # Cloudinary 由来の失敗（API エラー・タイムアウト・ネットワーク断）を 1 つにまとめる。
    # 扱いは呼び出し側が決める：issue 3-2 のコントローラは 502 + image_upload_failed、
    # issue 4-2 のジョブはリトライに乗せる。
    class UploadError < StandardError; end

    # 保存先フォルダ。パスに Rails.env を含めるので、ローカルの検証画像が
    # 本番の資産と混ざらない（同じ Cloudinary アカウントを共用する運用のため）。
    FOLDERS = {
      post: "posts",          # お題画像（issue 3-2）
      generated: "generated"  # 再現画像（issue 4-2）
    }.freeze

    def self.call(file, kind:) = new(file, kind: kind).call

    def initialize(file, kind:)
      @file = file
      @kind = kind
    end

    # @return [String] Cloudinary の public_id。DB に入れるのはこれだけ。
    def call
      # 未知の kind はここで KeyError。プログラミングエラーなので UploadError に包まない。
      target = folder

      upload_to(target).fetch("public_id")
    end

    private

    def folder
      "kotoe/#{Rails.env}/#{FOLDERS.fetch(@kind)}"
    end

    # 例外クラスは SDK のバージョンや失敗の種類（HTTP エラー・タイムアウト）で
    # 変わるため、呼び出し側が 1 つ rescue すれば済むようここで一本化する。
    #
    # 元例外の message は含めない。Cloudinary のエラー本文に接続文字列や
    # キーが混ざる可能性があり、ログに秘密情報を出さないため。
    def upload_to(target)
      Cloudinary::Uploader.upload(@file, folder: target, resource_type: "image")
    rescue StandardError => e
      raise UploadError, "Cloudinary upload failed: #{e.class}"
    end
  end
end
