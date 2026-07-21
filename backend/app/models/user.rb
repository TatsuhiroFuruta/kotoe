class User < ApplicationRecord
  # 最小構成。パスワードリセット(recoverable)・メール確認(confirmable)は
  # メール送信基盤が要るため MVP では持たない（必要になったら migration で追加する）。
  # validatable が email の形式・一意性と password の長さ（6文字以上）を担保する。
  devise :database_authenticatable, :registerable, :validatable,
         :jwt_authenticatable, jwt_revocation_strategy: JwtDenylist

  has_many :posts, dependent: :restrict_with_exception
  has_many :attempts, dependent: :restrict_with_exception
  has_many :likes, dependent: :destroy
  has_many :favorites, dependent: :destroy
  has_many :reports, foreign_key: :reporter_id, inverse_of: :reporter, dependent: :restrict_with_exception

  validates :name, presence: true
end
