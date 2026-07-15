FactoryBot.define do
  factory :report do
    association :reporter, factory: :user
    association :attempt
    reason { "不適切な画像" }
  end
end
