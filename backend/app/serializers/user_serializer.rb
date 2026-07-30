# API が返すユーザーの表現。
#
# 属性は 1 つずつ明示する。render json: user と書くと Rails は as_json を呼び、
# 既定では全カラムを出すため。
#
# ただし User に限っては devise が最初の一枚を守ってくれる。
# Devise::Models::Authenticatable が serializable_hash を上書きしており、
# encrypted_password / reset_password_token などが as_json から除かれる。
# それでも明示列挙にするのは、devise の除外リストが**固定**だから：
#   - 守られるのは devise 自身のカラムだけで、あとから users に足したカラム
#     （例: 管理フラグ）は素通りする
#   - email と timestamps は除外されない。投稿者として他人に見せる場面では出したくない
#   - as_json は 1 モデル 1 表現しか持てないが、User は本人向けと他人向けの 2 つが要る
#
# なお devise を使っていない Post / Attempt にはこの保護が一切無く、
# as_json は discarded_at のような内部状態まで出す。
class UserSerializer
  # 他人に見せる表現。お題の投稿者・挑戦者として出るときはこちら。email を含めない。
  def self.public_profile(user)
    { id: user.id, name: user.name }
  end

  # 本人向け。/api/me と sign_up / sign_in の応答で使う。
  def self.private_profile(user)
    { id: user.id, name: user.name, email: user.email }
  end
end
