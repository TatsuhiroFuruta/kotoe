require "rails_helper"

RSpec.describe JwtDenylist, type: :model do
  it "jwt_denylist テーブルを使う" do
    # Rails の複数形推論だと jwt_denylists になるため、明示指定できているかを確認する。
    expect(described_class.table_name).to eq("jwt_denylist")
  end

  it "devise-jwt の Denylist 戦略のインターフェースを備える" do
    expect(described_class).to respond_to(:jwt_revoked?)
    expect(described_class).to respond_to(:revoke_jwt)
  end

  it "jti と exp を保存できる" do
    record = described_class.create!(jti: "abc123", exp: 1.day.from_now)

    expect(record.reload.jti).to eq("abc123")
    expect(record.exp).to be_present
  end
end
