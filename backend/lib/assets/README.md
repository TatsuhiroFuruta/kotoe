# lib/assets

Zeitwerk の対象外（`config.autoload_lib(ignore: %w[assets tasks])`）のディレクトリ。
コードではないファイルを置く。

## dummy_generated.png

issue 4-2 のダミー生成画像。4-3 で本物の画像生成APIに差し替わるまで、
`GenerateImageJob` がこれを毎回 Cloudinary にアップロードする。

1024×1024 / RGB / 15,329 バイト。64px 幅の斜めストライプで、
生成結果ではないことが一目で分かるようにしてある。

バイナリは diff で中身を読めないので、再生成の手順を残す。
出力は決定的なので、同じコマンドで同じバイト列になる。

```bash
ruby -e '
require "zlib"
SIZE = 1024
def chunk(type, data)
  [ data.bytesize ].pack("N") + type + data + [ Zlib.crc32(type + data) ].pack("N")
end
ihdr = [ SIZE, SIZE ].pack("NN") + [ 8, 2, 0, 0, 0 ].pack("C5")
raw = +""
SIZE.times do |y|
  raw << "\x00".b
  SIZE.times { |x| raw << (((x + y) / 64).even? ? "\x3C\x3F\x4A".b : "\x2A\x2D\x36".b) }
end
png = "\x89PNG\r\n\x1A\n".b + chunk("IHDR", ihdr) + chunk("IDAT", Zlib::Deflate.deflate(raw, 9)) + chunk("IEND", "")
File.binwrite("backend/lib/assets/dummy_generated.png", png)
'
```
