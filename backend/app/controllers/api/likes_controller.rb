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
    rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
      # 並行リクエストが先に作っていた場合。競合相手の INSERT がコミット済みなら
      # uniqueness バリデーションが（RecordInvalid）、まだ進行中なら複合ユニーク
      # インデックスが（RecordNotUnique）検知する。どちらも最終状態は要求どおり
      # 「いいね済み」なので成功として扱う。rescue しないと同時クリックで 500 になる。
      render json: { attempt: attempt_json(attempt) }
    end

    private

    # いいねできるのは公開済みの挑戦だけ。下書き・生成中・失敗・削除済み・存在しない ID は
    # すべて RecordNotFound → 404 になる。403 と分けないのは、他人の下書きの存在を
    # 漏らさないため（AttemptsController#visible_attempt と同じ方針）。
    def likeable_attempt
      Attempt.kept.published.find(params[:attempt_id])
    end

    def render_error(code)
      render json: { error: code }, status: :unprocessable_content
    end
  end
end
