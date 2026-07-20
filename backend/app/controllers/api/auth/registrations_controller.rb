module Api
  module Auth
    # 新規登録。Devise::RegistrationsController#create の応答だけ JSON に差し替える。
    class RegistrationsController < Devise::RegistrationsController
      private

      # 成功時の JWT は devise-jwt が Authorization ヘッダに載せる（ここでは触らない）。
      # 失敗時はフィールド別のエラーキーだけを返し、表示用の文言はフロントに任せる。
      def respond_with(resource, _opts = {})
        if resource.persisted?
          render json: user_json(resource), status: :created
        else
          render json: { errors: resource.errors.to_hash }, status: :unprocessable_content
        end
      end
    end
  end
end
