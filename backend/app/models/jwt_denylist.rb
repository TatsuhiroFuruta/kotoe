# devise-jwt の Denylist 戦略。sign_out したトークンの jti をここに記録し、
# 以降そのトークンでのリクエストを拒否する。
# 認証インフラのテーブルなので discard（論理削除）は付けない。
class JwtDenylist < ApplicationRecord
  include Devise::JWT::RevocationStrategies::Denylist

  # Rails の複数形推論では jwt_denylists になってしまうため明示する。
  self.table_name = "jwt_denylist"
end
