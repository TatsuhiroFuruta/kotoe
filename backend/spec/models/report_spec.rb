require "rails_helper"

RSpec.describe Report, type: :model do
  it "有効な factory を持つ" do
    expect(build(:report)).to be_valid
  end

  it "reason が無いと無効" do
    expect(build(:report, reason: nil)).to be_invalid
  end

  it "reporter（User）と attempt に紐づく" do
    report = create(:report)
    expect(report.reporter).to be_a(User)
    expect(report.attempt).to be_a(Attempt)
  end

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
