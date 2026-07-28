require "rails_helper"

RSpec.describe Images::Uploader do
  let(:file) { StringIO.new("dummy") }

  describe ".call" do
    it "public_id を返す" do
      allow(Cloudinary::Uploader).to receive(:upload).and_return(
        "public_id" => "kotoe/test/posts/abc123",
        "secure_url" => "https://res.cloudinary.com/demo/image/upload/abc123.png"
      )

      expect(described_class.call(file, kind: :post)).to eq("kotoe/test/posts/abc123")
    end

    it "渡されたファイルをそのまま Cloudinary に渡す" do
      described_class.call(file, kind: :post)

      expect(Cloudinary::Uploader).to have_received(:upload) do |uploaded, _options|
        expect(uploaded).to be(file)
      end
    end

    # cloudinary gem の handle_file_param（utils.rb）は StringIO のときしか rewind しない。
    # Tempfile / ActionDispatch::Http::UploadedFile は現在位置から読まれるため、
    # 呼び出し側が先に読んでいると無言で切り詰められた画像が上がる。ここで戻す。
    it "アップロード前に IO の位置を先頭へ戻す" do
      file.read
      expect(file.pos).not_to eq(0)

      described_class.call(file, kind: :post)

      expect(Cloudinary::Uploader).to have_received(:upload) do |uploaded, _options|
        expect(uploaded.pos).to eq(0)
      end
    end

    it "rewind を持たない入力でも落ちない" do
      expect { described_class.call(Object.new, kind: :post) }.not_to raise_error
    end

    # ローカルと本番で同じ Cloudinary アカウントを共用するため、
    # 保存先に環境名を含めて資産が混ざらないようにしている。
    it "お題画像を kotoe/<env>/posts へ上げる" do
      described_class.call(file, kind: :post)

      expect(Cloudinary::Uploader).to have_received(:upload) do |_uploaded, options|
        expect(options[:folder]).to eq("kotoe/test/posts")
      end
    end

    it "生成画像を kotoe/<env>/generated へ上げる" do
      described_class.call(file, kind: :generated)

      expect(Cloudinary::Uploader).to have_received(:upload) do |_uploaded, options|
        expect(options[:folder]).to eq("kotoe/test/generated")
      end
    end

    # 省略すると既定が "auto" になり、動画や任意のバイナリまで受け付けてしまう。
    it "resource_type を image に固定する" do
      described_class.call(file, kind: :post)

      expect(Cloudinary::Uploader).to have_received(:upload) do |_uploaded, options|
        expect(options[:resource_type]).to eq("image")
      end
    end

    # 黙って既定フォルダに入れず、プログラミングエラーとして落とす。
    it "未知の kind は KeyError で落とす" do
      expect { described_class.call(file, kind: :unknown) }.to raise_error(KeyError)
    end

    context "Cloudinary が失敗したとき" do
      # レスポンス形状が変わったときに 500 ではなく 502 を返せるようにする。
      # kind の KeyError（プログラミングエラー）とは区別したままにする。
      it "レスポンスに public_id が無ければ UploadError に包む" do
        allow(Cloudinary::Uploader).to receive(:upload).and_return(
          "secure_url" => "https://res.cloudinary.com/demo/image/upload/abc123.png"
        )

        expect { described_class.call(file, kind: :post) }
          .to raise_error(Images::Uploader::UploadError, /public_id/)
      end

      it "タイムアウトを UploadError に包み直す" do
        allow(Cloudinary::Uploader).to receive(:upload).and_raise(Timeout::Error)

        expect { described_class.call(file, kind: :post) }
          .to raise_error(Images::Uploader::UploadError)
      end

      it "SDK 由来の例外を UploadError に包み直す" do
        allow(Cloudinary::Uploader).to receive(:upload).and_raise(StandardError, "boom")

        expect { described_class.call(file, kind: :post) }
          .to raise_error(Images::Uploader::UploadError)
      end

      # 元例外のメッセージには API キーやレスポンス本文が混ざりうるので持ち回らない
      # （CLAUDE.md：秘密情報をログに出さない）。
      it "元の例外メッセージを持ち回らない" do
        allow(Cloudinary::Uploader).to receive(:upload)
          .and_raise(StandardError, "cloudinary://key:secret@cloud is invalid")

        expect { described_class.call(file, kind: :post) }
          .to raise_error(Images::Uploader::UploadError, "Cloudinary upload failed: StandardError")
      end
    end
  end
end
