module Api
  module Auth
    # 新規登録。Devise::RegistrationsController#create の応答だけ JSON に差し替える。
    class RegistrationsController < Devise::RegistrationsController
      private

      # 成功時の JWT は devise-jwt が Authorization ヘッダに載せる（ここでは触らない）。
      # 失敗時はフィールド別のエラーコードだけを返す。判定はバック、文言・i18n はフロントの
      # 責務（CLAUDE.md）なので、英語の説明文ではなくコードで返す。
      def respond_with(resource, _opts = {})
        if resource.persisted?
          render json: user_json(resource), status: :created
        else
          render json: { errors: error_codes(resource) }, status: :unprocessable_content
        end
      end

      # errors.details は { field: [{ error: :taken, ... }] } の形で、:error 以外にも
      # 付随情報（例: count）を持つことがあるが、ここではコードだけ使うので捨てる。
      def error_codes(resource)
        resource.errors.details.transform_values { |details| details.pluck(:error) }
      end

      # api_only ではセッションが無く、Devise の sign_up は内部で
      # warden.set_user を呼んでセッションへ書き込もうとして落ちる。
      # JWT は Warden の after_set_user フックで発行され、セッション書き込みには
      # 依存しないため、store: false で書き込みだけを飛ばす。
      def sign_up(resource_name, resource)
        sign_in(resource_name, resource, store: false)
      end
    end
  end
end
