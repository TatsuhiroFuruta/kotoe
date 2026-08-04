# 外部への HTTP を全 spec で塞ぐ。require するだけで WebMock が Net::HTTP を
# 差し替え、スタブしていない通信は例外になる。
#
# spec/support/cloudinary.rb が Cloudinary SDK について用意しているのと同じ性質を、
# HTTP レベルで得る。素通りして偽のデータを返すより、うるさく失敗する方がよい。
#
# 画像生成API（issue 4-3）は SDK を使わず Net::HTTP を直接叩くため、
# リクエストの組み立て（URL・ヘッダ・ボディ）そのものが検証対象になる。
require "webmock/rspec"
