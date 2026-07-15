FactoryBot.define do
  factory :post do
    association :user
    sequence(:title) { |n| "お題#{n}" }
    image_public_id { "kotoe/sample_post" }
  end
end
