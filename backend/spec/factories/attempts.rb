FactoryBot.define do
  factory :attempt do
    association :post
    association :user
    description { "青い空と白い雲" }
  end
end
