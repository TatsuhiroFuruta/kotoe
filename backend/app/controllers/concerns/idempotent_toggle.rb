# トグル（いいね／お気に入り）の ON を冪等にする手順の共有。
# LikesController と FavoritesController が使う。
#
# POST を「レコードを作成せよ」ではなく「その状態にせよ」という命令として解釈する。
# すでにその状態でも、並行リクエストと競合しても、成功としてブロックを評価する。
module IdempotentToggle
  extend ActiveSupport::Concern

  private

  # 成功時はブロックの戻り値を返す（応答の組み立ては呼び出し元の責務）。
  #
  # 捕まえる例外が 2 つあるのは、複合ユニークインデックスとアプリ側の uniqueness
  # バリデーションのどちらが先に当たるかが、競合相手の状態で変わるため。
  # RecordNotUnique だけを rescue すると、競合相手がコミット済みのケースで 500 になる。
  def toggle_on(association, target)
    association.find_or_create_by!(target)
    yield
  rescue ActiveRecord::RecordNotUnique
    # 並行リクエストの INSERT がまだ進行中で、複合ユニークインデックスが検知した場合。
    # 最終状態は要求どおり「ON」なので成功として扱う。
    # rescue しないと同時クリックで 500 になる。
    yield
  rescue ActiveRecord::RecordInvalid => e
    # 並行リクエストの INSERT がコミット済みで、uniqueness バリデーションが
    # 検知した場合。重複だけを成功に読み替える。
    #
    # RecordInvalid をまとめて握り潰さないのは、将来バリデーションが増えたときに、
    # 弾かれたトグルが 200 と false で返り、エラーコードも出ないまま
    # フロントが失敗に気づけなくなるため。重複以外は通常の検証エラーとして返す。
    duplicate_only?(e.record) ? yield : render_validation_errors(e.record)
  end

  # 「重複していた」だけが原因か。of_kind? では足りない。あれは重複が**含まれていれば**
  # true なので、重複と別の原因が同時に立ったときに別の原因ごと成功に読み替えてしまう。
  # errors が空の RecordInvalid を重複と誤認しないよう any? も見る（all? は空で true）。
  #
  # Like も Favorite も uniqueness を user_id にスコープ付きで宣言しているため、
  # 重複のエラーは attribute が :user_id、type が :taken で共通になる。
  def duplicate_only?(record)
    record.errors.any? &&
      record.errors.all? { |error| error.attribute == :user_id && error.type == :taken }
  end
end
