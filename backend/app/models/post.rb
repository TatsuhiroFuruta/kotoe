class Post < ApplicationRecord
  include Discard::Model

  belongs_to :user
  has_many :attempts, dependent: :restrict_with_exception
  has_many :favorites, dependent: :destroy

  validates :title, presence: true
  validates :image_public_id, presence: true
end
