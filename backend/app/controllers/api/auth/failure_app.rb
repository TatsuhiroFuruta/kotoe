module Api
  module Auth
    # 認証の失敗（パスワード不一致・トークン無し・失効トークン）は
    # コントローラに到達せず Warden がここで処理する。
    # 既定の Devise::FailureApp は HTML へリダイレクトするため、JSON を返すよう差し替える。
    class FailureApp < Devise::FailureApp
      def respond
        self.status = 401
        self.content_type = "application/json"
        self.response_body = { error: error_code }.to_json
      end

      private

      # 表示用の文言ではなく機械可読なコードを返す（翻訳はフロントの責務）。
      def error_code
        warden_message == :invalid ? "invalid_credentials" : "unauthorized"
      end
    end
  end
end
