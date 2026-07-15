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
end
