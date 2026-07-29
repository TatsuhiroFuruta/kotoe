# API が返すユーザーの表現。
#
# 属性は 1 つずつ明示する。render json: user と書くと Rails は as_json を呼び、
# 既定では全カラム（encrypted_password を含む）を出す。さらに怖いのは、
# 将来 users にカラムを足したときにコードを変えていないのに漏れることで、
# 明示列挙にしておけばその事故が起きない。
class UserSerializer
  # 本人向け。/api/me と sign_up / sign_in の応答で使う。
  def self.private_profile(user)
    { id: user.id, name: user.name, email: user.email }
  end
end
