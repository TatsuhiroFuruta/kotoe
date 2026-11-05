# お題のタイトルを任意にする（無題は NULL）。
#
# down（NOT NULL に戻す）は NULL の行があると失敗する。戻すときは先に埋めること。
class ChangePostsTitleNull < ActiveRecord::Migration[8.1]
  def change
    change_column_null :posts, :title, true
  end
end
