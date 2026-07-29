FactoryBot.define do
  factory :attempt do
    association :post
    association :user
    description { "青い空と白い雲" }

    # 公開済みの挑戦。一覧の集計や詳細に出るのはこの状態のものだけ。
    # draft は enum の既定値なので trait は要らない。
    trait :published do
      status { "published" }
      generated_image_public_id { "kotoe/test/generated/sample" }
    end
  end
end
