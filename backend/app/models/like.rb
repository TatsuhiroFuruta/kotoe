class Like < ApplicationRecord
  belongs_to :user
  belongs_to :attempt

  validates :user_id, uniqueness: { scope: :attempt_id }
end
