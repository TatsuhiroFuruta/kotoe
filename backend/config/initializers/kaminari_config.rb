# 1 ページの件数はサーバー側で固定する。max_per_page も同じ値にしておくと、
# 将来 params[:per] を受け取る実装が入っても一度に全件取られることがない。
Kaminari.configure do |config|
  config.default_per_page = 12
  config.max_per_page = 12
end
