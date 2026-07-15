class Report < ApplicationRecord
  include Discard::Model

  belongs_to :reporter, class_name: "User"
  belongs_to :attempt

  validates :reason, presence: true
end
