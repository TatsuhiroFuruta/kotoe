require "rails_helper"

RSpec.describe User, type: :model do
  it "有効な factory を持つ" do
    expect(build(:user)).to be_valid
  end

  it "name が無いと無効" do
    expect(build(:user, name: nil)).to be_invalid
  end
end
