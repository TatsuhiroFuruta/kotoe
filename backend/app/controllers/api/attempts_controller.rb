module Api
  # 挑戦（Attempt）。生成の可否や回数の判定は Attempts::Generation に、JSON の形は
  # シリアライザに寄せ、ここは HTTP の入出力だけを扱う。
  class AttemptsController < ApplicationController
    # show だけ認証不要。公開済みの挑戦は誰でも見られる（共有用パーマリンク）。
    before_action :authenticate_user!, except: :show

    def create
      # 削除済み・存在しないお題は RecordNotFound → 404。
      post = Post.kept.find(params[:post_id])
      attempt = current_user.attempts.new(post: post, description: attempt_attributes[:description])

      return render_validation_errors(attempt) unless attempt.save

      render json: { attempt: attempt_json(attempt) }, status: :created
    end

    def update
      attempt = owned_attempt
      return render_error("attempt_not_draft") unless attempt.draft?

      attempt.description = attempt_attributes[:description]
      return render_validation_errors(attempt) unless attempt.save

      render json: { attempt: attempt_json(attempt) }
    end

    def generate
      attempt = owned_attempt
      result = Attempts::Generation.call(attempt)

      return render_generation_error(result) unless result.ok?

      render json: { attempt: attempt_json(attempt) }, status: :accepted
    end

    def show
      attempt = visible_attempt
      post = Post.kept.includes(:user).with_counts.find(attempt.post_id)

      render json: { attempt: AttemptSerializer.call(attempt), post: PostSerializer.call(post) }
    end

    def destroy
      # 生成中でも削除できる。ジョブ側が kept で絞っているので、走っても何もしない。
      # generated_at は消さない（削除しても回数は戻さない）。
      owned_attempt.discard!
      head :no_content
    end

    private

    # current_user.attempts に限定することで、所有チェックの書き忘れが起こりようがない。
    # 他人の挑戦・存在しない ID・削除済みは、すべて RecordNotFound → 404 になる。
    def owned_attempt
      current_user.attempts.kept.find(params[:id])
    end

    # 公開済みは誰でも、それ以外は本人だけ。見えない場合は 403 ではなく 404 にして
    # 存在ごと隠す。未認証も 401 ではなく 404 にする（published が認証不要である以上、
    # 401 は「認証すれば見える何かがある」と漏らすため）。
    def visible_attempt
      attempt = Attempt.kept.includes(:user).with_likes_count.find(params[:id])
      raise ActiveRecord::RecordNotFound unless attempt.published? || attempt.user_id == current_user&.id

      attempt
    end

    # params[:attempt] の型はクライアントが決められる。スカラー（attempt=foo）や
    # 配列（attempt[]=foo）を送られても 500 にせず、通常の検証エラー（422）として扱う。
    #
    # respond_to?(:dig) では足りない。Array も dig に応答するため素通りし、
    # ["foo"][:description] が TypeError になる。受け取ってよい型だけを名指しする。
    def attempt_attributes
      params[:attempt].is_a?(ActionController::Parameters) ? params[:attempt] : {}
    end

    # AttemptSerializer は with_likes_count が SELECT 句で付ける別名属性に依存している。
    # 新規・更新直後のレコードには乗っていないので、そのスコープ経由で取り直す。
    # 0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。
    def attempt_json(attempt)
      AttemptSerializer.call(Attempt.includes(:user).with_likes_count.find(attempt.id))
    end

    def render_validation_errors(attempt)
      errors = attempt.errors.details.transform_values { |details| details.pluck(:error) }
      render json: { errors: errors }, status: :unprocessable_content
    end

    def render_error(code, extra = {})
      render json: { error: code }.merge(extra), status: :unprocessable_content
    end

    # 上限到達のときだけ、フロントが「あと◯時間で回復します」を組み立てられるよう
    # 補助情報を足す。文言そのものは返さない（i18n はフロント）。
    def render_generation_error(result)
      return render_error(result.error_code) if result.limit.nil?

      render_error(result.error_code, limit: result.limit, resets_at: next_reset_at)
    end

    # 「1日」は JST の暦日なので回復は JST の翌 0 時。返す形は他のフィールドと同じく
    # UTC の ISO8601 に揃える。
    def next_reset_at
      Time.zone.tomorrow.beginning_of_day.utc.iso8601
    end
  end
end
