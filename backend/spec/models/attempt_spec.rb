require "rails_helper"

RSpec.describe Attempt, type: :model do
  it "有効な factory を持つ" do
    expect(build(:attempt)).to be_valid
  end

  it { is_expected.to belong_to(:post) }
  it { is_expected.to belong_to(:user) }
  it { is_expected.to have_many(:likes).dependent(:destroy) }
  it { is_expected.to have_many(:reports).dependent(:restrict_with_exception) }

  it { is_expected.to validate_presence_of(:description) }
  it { is_expected.to validate_length_of(:description).is_at_most(1000) }
  it { is_expected.to validate_inclusion_of(:failure_reason).in_array(described_class::FAILURE_REASONS).allow_nil }

  # description はそのまま画像生成APIのプロンプトになる。無制限だとコストとエラーの
  # 両方に効くため上限を持つ（設計ドキュメント参照）。
  it "1,000 文字ちょうどは通り、1,001 文字は too_long で落ちる" do
    expect(build(:attempt, description: "あ" * 1000)).to be_valid

    attempt = build(:attempt, description: "あ" * 1001)
    expect(attempt).not_to be_valid
    expect(attempt.errors.details[:description].pluck(:error)).to include(:too_long)
  end

  it "generated_at は既定で nil" do
    expect(create(:attempt).generated_at).to be_nil
  end

  it "status は既定で draft" do
    expect(Attempt.new.status).to eq("draft")
  end

  it "generated_image_public_id と similarity_score は null 可" do
    attempt = build(:attempt, generated_image_public_id: nil, similarity_score: nil)
    expect(attempt).to be_valid
  end

  it "status enum のスコープと述語が使える" do
    attempt = create(:attempt, status: "published")
    expect(attempt.published?).to be true
    expect(Attempt.published).to include(attempt)
  end

  it "未知の status を代入すると ArgumentError" do
    expect { build(:attempt, status: "unknown") }.to raise_error(ArgumentError)
  end

  it "discard すると kept から外れ discarded に入る" do
    attempt = create(:attempt)
    attempt.discard
    expect(attempt.discarded?).to be true
    expect(Attempt.kept).not_to include(attempt)
    expect(Attempt.discarded).to include(attempt)
  end

  describe ".listing_for" do
    let(:post) { create(:post) }

    it "published かつ未削除の挑戦を新着順で返す" do
      older = create(:attempt, :published, post: post, created_at: 2.days.ago)
      newer = create(:attempt, :published, post: post, created_at: 1.day.ago)

      expect(Attempt.listing_for(post).map(&:id)).to eq([ newer.id, older.id ])
    end

    it "下書きを含めない" do
      create(:attempt, post: post)

      expect(Attempt.listing_for(post)).to be_empty
    end

    it "削除済みの挑戦を含めない" do
      create(:attempt, :published, post: post).discard!

      expect(Attempt.listing_for(post)).to be_empty
    end

    it "他のお題の挑戦を含めない" do
      create(:attempt, :published, post: create(:post))

      expect(Attempt.listing_for(post)).to be_empty
    end

    it "likes_count を持つ" do
      attempt = create(:attempt, :published, post: post)
      create_list(:like, 2, attempt: attempt)

      expect(Attempt.listing_for(post).first.likes_count).to eq(2)
    end

    # いいねの多い挑戦をわざと「古い」ほうに置く。こうしないと新着順でも同じ並びになり、
    # popular を実装しなくてもテストが通ってしまう。
    it "sort: \"likes\" でいいねの多い順に並ぶ" do
      many = create(:attempt, :published, post: post, created_at: 2.days.ago)
      few = create(:attempt, :published, post: post, created_at: 1.day.ago)
      create_list(:like, 3, attempt: many)
      create(:like, attempt: few)

      expect(Attempt.listing_for(post, sort: "likes").map(&:id)).to eq([ many.id, few.id ])
    end

    # 同着で順序が不定になると、ページをまたいで重複や抜けが出る（Post.popular と同じ理由）。
    it "sort: \"likes\" の同着は新着順、created_at も同着なら id の降順" do
      old = create(:attempt, :published, post: post, created_at: 2.days.ago)
      same_a = create(:attempt, :published, post: post, created_at: 1.day.ago)
      same_b = create(:attempt, :published, post: post, created_at: 1.day.ago)

      expect(Attempt.listing_for(post, sort: "likes").map(&:id)).to eq([ same_b.id, same_a.id, old.id ])
    end

    it "未知の sort は新着順にフォールバックする" do
      old_and_popular = create(:attempt, :published, post: post, created_at: 2.days.ago)
      newer = create(:attempt, :published, post: post, created_at: 1.day.ago)
      create_list(:like, 3, attempt: old_and_popular)

      expect(Attempt.listing_for(post, sort: "nonsense").map(&:id)).to eq([ newer.id, old_and_popular.id ])
    end
  end
end
