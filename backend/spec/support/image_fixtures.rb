# 画像判定のテストで使うサンプル。
#
# 形式の判定はファイル先頭のマジックバイトしか見ないため、本物の画像は要らない。
# バイナリを fixture としてコミットすると中身が diff で見えずレビューできないので、
# バイト列を定数で持ち、ここから IO を組み立てる。
# サイズ境界のテスト（5MB ちょうど / +1 バイト）も、巨大ファイルを
# リポジトリに置かずにパディングで作れる。
module ImageFixtures
  # 実際に marcel 1.2.1 で判定を確認した値。
  #   heic / heif … ISO base media 形式:
  #   [4byte box size]["ftyp"][major brand][minor version][compatible brands]
  MAGIC_BYTES = {
    heic: [ "\x00\x00\x00\x18", "ftyp", "heic", "\x00\x00\x00\x00", "mif1heic" ].join,
    heif: [ "\x00\x00\x00\x18", "ftyp", "mif1", "\x00\x00\x00\x00", "mif1heic" ].join,
    jpeg: "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00",
    png: "\x89PNG\r\n\x1A\n",
    webp: "RIFF\x24\x00\x00\x00WEBPVP8 ",
    pdf: "%PDF-1.4\n",
    text: "this is not an image"
  }.freeze

  # 指定形式のマジックバイトを持つ IO。
  # bytesize を渡すと、その大きさになるまで末尾を 0 で埋める。
  def image_io(format, bytesize: nil)
    StringIO.new(image_bytes(format, bytesize: bytesize))
  end

  # フォームから飛んでくる形。filename / type はクライアント申告の値なので、
  # 中身と食い違う組み合わせ（詐称）も作れる。
  def uploaded_file(format, filename:, type:, bytesize: nil)
    tempfile = Tempfile.new("image-fixture")
    tempfile.binmode
    tempfile.write(image_bytes(format, bytesize: bytesize))
    tempfile.rewind

    ActionDispatch::Http::UploadedFile.new(tempfile: tempfile, filename: filename, type: type)
  end

  private

  def image_bytes(format, bytesize: nil)
    magic = MAGIC_BYTES.fetch(format).dup.force_encoding(Encoding::BINARY)
    return magic if bytesize.nil?

    if bytesize < magic.bytesize
      raise ArgumentError,
        "bytesize (#{bytesize}) が #{format} のマジックバイト長 (#{magic.bytesize}) より小さい。" \
        "途中で切れたファイルを作りたい場合は image_bytes ではなく直接組み立てること。"
    end

    magic + ("\0".b * (bytesize - magic.bytesize))
  end
end

RSpec.configure do |config|
  config.include ImageFixtures
end
