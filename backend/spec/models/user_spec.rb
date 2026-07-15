require "rails_helper"

RSpec.describe User, type: :model do
  it "有効な factory を持つ" do
    expect(build(:user)).to be_valid
  end

  it { is_expected.to have_many(:posts).dependent(:restrict_with_exception) }
  it { is_expected.to have_many(:attempts).dependent(:restrict_with_exception) }
  it { is_expected.to have_many(:likes).dependent(:destroy) }
  it { is_expected.to have_many(:favorites).dependent(:destroy) }
  it { is_expected.to have_many(:reports).with_foreign_key(:reporter_id).dependent(:restrict_with_exception) }

  it { is_expected.to validate_presence_of(:name) }
end
