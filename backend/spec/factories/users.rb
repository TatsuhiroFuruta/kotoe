FactoryBot.define do
  factory :user do
    sequence(:name) { |n| "user#{n}" }
    sequence(:email) { |n| "user#{n}@example.com" }
    # request spec のログインヘルパがこの固定値を使う。
    password { "password123" }
  end
end
