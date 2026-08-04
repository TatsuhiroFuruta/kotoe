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

    # 生成中。GenerateImageJob と Attempts::Generation の spec が使う。
    trait :generating do
      status { "generating" }
      generated_at { Time.current }
    end

    # 失敗した挑戦は必ず理由を持つ（ジョブが status と一緒に書く）ので、
    # trait もその形にしておく。
    trait :failed do
      status { "failed" }
      generated_at { Time.current }
      failure_reason { "api_error" }
    end
  end
end
