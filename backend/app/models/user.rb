class User < ApplicationRecord
  has_many :posts, dependent: :restrict_with_exception
  has_many :attempts, dependent: :restrict_with_exception
  has_many :likes, dependent: :destroy
  has_many :favorites, dependent: :destroy
  has_many :reports, foreign_key: :reporter_id, inverse_of: :reporter, dependent: :restrict_with_exception

  validates :name, presence: true
end
