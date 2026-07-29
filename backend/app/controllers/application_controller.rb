class ApplicationController < ActionController::API
  before_action :configure_permitted_parameters, if: :devise_controller?

  # API モードでは例外がそのまま HTML のエラーページ経路に流れるため、JSON に揃える。
  # find が見つからないケース（削除済み・存在しない ID・他人のリソース）はすべてここに来る。
  rescue_from ActiveRecord::RecordNotFound do
    render json: { error: "not_found" }, status: :not_found
  end

  protected

  # devise の既定は email / password だけなので、sign_up で name も受け取れるようにする。
  def configure_permitted_parameters
    devise_parameter_sanitizer.permit(:sign_up, keys: [ :name ])
  end
end
