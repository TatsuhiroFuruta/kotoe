FactoryBot.define do
  factory :like do
    association :user
    association :attempt
  end
end
