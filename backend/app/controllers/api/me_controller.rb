module Api
  class MeController < ApplicationController
    before_action :authenticate_user!

    # 「いま誰でログインしているか」だけを返す。
    def show
      render json: user_json(current_user)
    end
  end
end
