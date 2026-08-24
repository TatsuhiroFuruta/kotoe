module Api
  class MeController < ApplicationController
    before_action :authenticate_user!

    # 「いま誰でログインしているか」と、マイページのヘッダーに出す統計。
    def show
      render json: UserSerializer.private_profile_with_stats(current_user)
    end
  end
end
