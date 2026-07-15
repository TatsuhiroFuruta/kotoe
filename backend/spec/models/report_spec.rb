require "rails_helper"

RSpec.describe Report, type: :model do
  it "有効な factory を持つ" do
    expect(build(:report)).to be_valid
  end

  it { is_expected.to belong_to(:reporter).class_name("User") }
  it { is_expected.to belong_to(:attempt) }

  it { is_expected.to validate_presence_of(:reason) }

  it "User から reporter として reports を辿れる" do
    user = create(:user)
    report = create(:report, reporter: user)
    expect(user.reports).to include(report)
  end

  it "discard すると kept から外れ discarded に入る" do
    report = create(:report)
    report.discard
    expect(report.discarded?).to be true
    expect(Report.kept).not_to include(report)
    expect(Report.discarded).to include(report)
  end
end
