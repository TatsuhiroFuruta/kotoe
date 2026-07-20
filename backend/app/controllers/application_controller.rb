class ApplicationController < ActionController::API
  before_action :configure_permitted_parameters, if: :devise_controller?

  protected

  # devise の既定は email / password だけなので、sign_up で name も受け取れるようにする。
  def configure_permitted_parameters
    devise_parameter_sanitizer.permit(:sign_up, keys: [ :name ])
  end

  # API が返すユーザーの表現。encrypted_password 等を漏らさないよう属性を明示する
  # （モデルの as_json に任せない）。本格的なシリアライザ整備は issue 3-2。
  def user_json(user)
    { id: user.id, name: user.name, email: user.email }
  end
end
