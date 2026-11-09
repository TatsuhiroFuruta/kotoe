namespace :e2e do
  desc "E2E が Cloudinary に上げた画像を KOTOE_CLOUDINARY_FOLDER の配下だけ消す"
  task cleanup_cloudinary: :environment do
    prefix = ENV["KOTOE_CLOUDINARY_FOLDER"].to_s.strip
    next if prefix.empty?

    # 応答本文は出さず、件数だけ表示する。
    puts "Cloudinary: #{E2e::CloudinaryCleanup.call(prefix)} 件の画像を削除しました"
  end
end
