require "rails_helper"

RSpec.describe Post, type: :model do
  it "有効な factory を持つ" do
    expect(build(:post)).to be_valid
  end

  it { is_expected.to belong_to(:user) }
  it { is_expected.to have_many(:attempts).dependent(:restrict_with_exception) }
  it { is_expected.to have_many(:favorites).dependent(:destroy) }

  it { is_expected.to validate_presence_of(:title) }
  it { is_expected.to validate_presence_of(:image_public_id) }

  it "discard すると kept から外れ discarded に入る" do
    post = create(:post)
    post.discard
    expect(post.discarded?).to be true
    expect(Post.kept).not_to include(post)
    expect(Post.discarded).to include(post)
  end

  it "1 ページは 12 件" do
    expect(Post.page(1).limit_value).to eq(12)
  end

  describe ".listing" do
    it "削除済みのお題を返さない" do
      kept_post = create(:post)
      discarded_post = create(:post)
      discarded_post.discard!

      expect(Post.listing.map(&:id)).to eq([ kept_post.id ])
    end

    it "既定は新着順" do
      older = create(:post, created_at: 2.days.ago)
      newer = create(:post, created_at: 1.day.ago)

      expect(Post.listing.map(&:id)).to eq([ newer.id, older.id ])
    end

    it "attempts_count は published かつ未削除の挑戦だけを数える" do
      post = create(:post)
      create(:attempt, :published, post: post)
      create(:attempt, :published, post: post)
      create(:attempt, post: post)                       # 下書き
      create(:attempt, :published, post: post).discard!  # 削除済み

      expect(Post.listing.first.attempts_count).to eq(2)
    end

    it "likes_count は削除済み挑戦へのいいねを数えない" do
      post = create(:post)
      published = create(:attempt, :published, post: post)
      discarded = create(:attempt, :published, post: post)
      create_list(:like, 2, attempt: published)
      create(:like, attempt: discarded)
      discarded.discard!

      expect(Post.listing.first.likes_count).to eq(2)
    end

    it "挑戦が 1 件も無いお題も 0 件として返す（集計で消えない）" do
      create(:post)

      expect(Post.listing.first.attempts_count).to eq(0)
      expect(Post.listing.first.likes_count).to eq(0)
    end

    it "sort: popular はいいね合計の降順" do
      quiet = create(:post, created_at: 1.day.ago)
      loud = create(:post, created_at: 2.days.ago)
      create_list(:like, 2, attempt: create(:attempt, :published, post: loud))

      expect(Post.listing(sort: "popular").map(&:id)).to eq([ loud.id, quiet.id ])
    end

    it "未知の sort は新着順にフォールバックする" do
      older = create(:post, created_at: 2.days.ago)
      newer = create(:post, created_at: 1.day.ago)

      expect(Post.listing(sort: "nonsense").map(&:id)).to eq([ newer.id, older.id ])
    end

    it "q でタイトルの部分一致を絞り込む" do
      hit = create(:post, title: "夕暮れの交差点")
      create(:post, title: "朝の海")

      expect(Post.listing(q: "夕暮れ").map(&:id)).to eq([ hit.id ])
    end

    it "q の大文字小文字は区別しない" do
      hit = create(:post, title: "Sunset Beach")

      expect(Post.listing(q: "sunset").map(&:id)).to eq([ hit.id ])
    end

    it "q が空なら全件返す" do
      posts = create_list(:post, 2)

      expect(Post.listing(q: "").map(&:id)).to match_array(posts.map(&:id))
    end

    it "ransack で検索できる属性を title だけに絞っている" do
      expect(Post.ransackable_attributes).to eq(%w[title])
      expect(Post.ransackable_associations).to eq([])
    end
  end
end
