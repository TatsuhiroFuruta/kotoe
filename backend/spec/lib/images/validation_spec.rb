require "rails_helper"

RSpec.describe Images::Validation do
  describe ".call" do
    context "受け入れる形式" do
      %i[jpeg png webp heic heif].each do |format|
        it "#{format} を通す" do
          result = described_class.call(image_io(format))

          expect(result).to be_valid
          expect(result.error_code).to be_nil
        end
      end
    end

    context "受け入れない形式" do
      it "PDF を拒否する" do
        result = described_class.call(image_io(:pdf))

        expect(result).not_to be_valid
        expect(result.error_code).to eq("image_type_not_allowed")
      end

      it "テキストを拒否する" do
        expect(described_class.call(image_io(:text)).error_code).to eq("image_type_not_allowed")
      end

      # このクラスの存在意義。Content-Type やファイル名を信じる実装だと通ってしまう。
      it "中身がテキストなら、image/jpeg を名乗り拡張子が .jpg でも拒否する" do
        forged = uploaded_file(:text, filename: "innocent.jpg", type: "image/jpeg")

        expect(described_class.call(forged).error_code).to eq("image_type_not_allowed")
      end

      # 逆方向。中身が本物なら、申告が間違っていても通す。
      it "中身が PNG なら、text/plain を名乗っていても通す" do
        mislabeled = uploaded_file(:png, filename: "photo.txt", type: "text/plain")

        expect(described_class.call(mislabeled)).to be_valid
      end
    end

    context "サイズ" do
      it "5MB ちょうどを通す" do
        expect(described_class.call(image_io(:jpeg, bytesize: 5.megabytes))).to be_valid
      end

      it "5MB を 1 バイト超えたら拒否する" do
        result = described_class.call(image_io(:jpeg, bytesize: 5.megabytes + 1))

        expect(result.error_code).to eq("image_too_large")
      end

      # サイズを形式より先に見るので、巨大な非画像は中身を読まずに弾ける。
      it "サイズ超過を形式より先に判定する" do
        result = described_class.call(image_io(:text, bytesize: 5.megabytes + 1))

        expect(result.error_code).to eq("image_too_large")
      end
    end

    context "ファイルがない" do
      it "nil を拒否する" do
        expect(described_class.call(nil).error_code).to eq("image_missing")
      end

      it "空ファイルを拒否する" do
        expect(described_class.call(StringIO.new("")).error_code).to eq("image_missing")
      end
    end

    # params[:image] の型はクライアントが決められる。ファイルパートではなく
    # 普通のフォーム値（image=foo）を送られても 500 にせず、エラーコードで弾く。
    context "ファイルとして扱えないものが来たとき" do
      it "文字列を拒否する" do
        expect(described_class.call("hello").error_code).to eq("image_missing")
      end

      it "配列を拒否する" do
        expect(described_class.call([ "a" ]).error_code).to eq("image_missing")
      end

      it "read / rewind を持たないオブジェクトを拒否する" do
        expect(described_class.call(Object.new).error_code).to eq("image_missing")
      end

      it "ActionController::Parameters を拒否する" do
        params = ActionController::Parameters.new(filename: "x.jpg")

        expect(described_class.call(params).error_code).to eq("image_missing")
      end
    end

    # 判定のあと、呼び出し側がそのまま Cloudinary へ渡せる状態にしておく。
    it "判定後に IO の位置を先頭へ戻す" do
      io = image_io(:png)
      described_class.call(io)

      expect(io.pos).to eq(0)
    end

    it "上限が 5MB である" do
      expect(described_class::MAX_BYTES).to eq(5.megabytes)
    end
  end
end
