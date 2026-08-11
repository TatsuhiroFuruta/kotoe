module Api
  # 再現いいね（Like）。トグルは冪等で、同じリクエストを何度送っても状態が変わらない。
  # POST は「この挑戦を、自分がいいねしている状態にせよ」という意味になる。
  class LikesController < ApplicationController
    include AttemptRendering

    before_action :authenticate_user!

    def create
      attempt = likeable_attempt
      # いいねは再現度への投票で、ベスト再現（6-1）と全体ランキング（6-2）の順位を
      # 直接決める。自分で自分に投票できると同着が自票で覆る。
      return render_error("cannot_like_own_attempt") if attempt.user_id == current_user.id

      current_user.likes.find_or_create_by!(attempt: attempt)
      render json: { attempt: attempt_json(attempt) }
    rescue ActiveRecord::RecordNotUnique
      # 並行リクエストの INSERT がまだ進行中で、複合ユニークインデックスが検知した場合。
      # 最終状態は要求どおり「いいね済み」なので成功として扱う。
      # rescue しないと同時クリックで 500 になる。
      render json: { attempt: attempt_json(attempt) }
    rescue ActiveRecord::RecordInvalid => e
      # 並行リクエストの INSERT がコミット済みで、uniqueness バリデーションが
      # 検知した場合。重複だけを成功に読み替える。
      #
      # RecordInvalid をまとめて握り潰さないのは、将来 Like にバリデーションが
      # 増えたときに、弾かれたいいねが 200 と liked: false で返り、エラーコードも
      # 出ないままフロントが失敗に気づけなくなるため。
      raise unless e.record.errors.of_kind?(:user_id, :taken)

      render json: { attempt: attempt_json(attempt) }
    end

    def destroy
      attempt = likeable_attempt
      # 解除は物理削除。likes には discarded_at が無く、行を残すと複合ユニークに
      # 引っかかって二度といいねし直せなくなる（CLAUDE.md の論理削除ルールの例外。
      # likes は何からも参照されておらず、取り消しに記録を残す意味も無い）。
      #
      # いいねしていなければ何もしない（冪等）。自分の挑戦でも 422 にしない。
      # セルフいいねを禁じている以上「いいねしていない状態」で確定しており、
      # 冪等な DELETE の定義どおり現状を返せばよい。
      current_user.likes.find_by(attempt: attempt)&.destroy

      render json: { attempt: attempt_json(attempt) }
    end

    private

    # いいねできるのは、生きているお題にぶら下がる公開済みの挑戦だけ。下書き・生成中・
    # 失敗・削除済み・存在しない ID は、すべて RecordNotFound → 404 になる。403 と
    # 分けないのは、他人の下書きの存在を漏らさないため（visible_attempt と同じ方針）。
    #
    # お題側も見るのは、Post#discard が挑戦にカスケードしないため。挑戦だけを見ると
    # kept かつ published のままで、読み取り API からは辿れない（お題が 404 になる）のに
    # いいねだけ書き込めてしまう。その票は Attempt.likes_count_sql に効き、
    # ベスト再現（6-1）と全体ランキング（6-2）で削除済みのお題の挑戦が順位を持つ。
    def likeable_attempt
      Attempt.kept.published.joins(:post).merge(Post.kept).find(params[:attempt_id])
    end

    def render_error(code)
      render json: { error: code }, status: :unprocessable_content
    end
  end
end
