class AddGeneratedAtToAttempts < ActiveRecord::Migration[8.1]
  def change
    # この attempt が生成枠を1つ消費した時刻。generate の瞬間に一度だけ入り、以後変わらない。
    # discard しても消さないので「削除しても回数は戻さない」がデータの形で満たされる。
    # created_at では数えられない（前日に下書きを溜めれば上限をすり抜けられるため）。
    add_column :attempts, :generated_at, :datetime

    # 回数の判定クエリ（user_id ＋ generated_at の範囲）に合わせる。
    # 既存の index_attempts_on_user_id は先頭列が重なるが、6-3 のマイページが
    # user_id 単独で引くため残す。
    add_index :attempts, [ :user_id, :generated_at ]
  end
end
