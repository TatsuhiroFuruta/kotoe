module Api
  module Auth
    # ログイン / ログアウト。Devise::SessionsController の応答だけ JSON に差し替える。
    # 認証の「失敗」はここに来ない（Warden の FailureApp が処理する）。
    class SessionsController < Devise::SessionsController
      # Devise 既定の verify_signed_out_user は warden.user（セッションに書き込み済みの値）
      # だけを見て「サインイン中か」を判定するが、api_only ではセッションを使わないため
      # 常に signed-out 扱いになってしまう。sign_out はトークンの検証そのものが要件なので、
      # 通常の authenticate_user! に置き換え、トークン無し／不正は Warden の FailureApp に委ねる。
      # devise_controller? な自分自身の中では authenticate_user! は既定で no-op になる
      # （Devise が無限ループ防止のため force: true を要求する）ので明示的に強制する。
      prepend_before_action(only: :destroy) { authenticate_user!(force: true) }
      skip_before_action :verify_signed_out_user, only: :destroy

      private

      # JWT は devise-jwt が Authorization ヘッダに載せる（ここでは触らない）。
      def respond_with(resource, _opts = {})
        render json: user_json(resource), status: :ok
      end

      # トークンの失効（jwt_denylist への記録）は devise-jwt が行う。
      # body は空だが、JSON API として 401 の応答と content-type を揃える。
      def respond_to_on_destroy(non_navigational_status: :no_content)
        head :ok, content_type: "application/json"
      end
    end
  end
end
