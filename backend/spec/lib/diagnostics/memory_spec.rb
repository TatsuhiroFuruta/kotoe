require "rails_helper"

RSpec.describe Diagnostics::Memory do
  # 実際の /proc や /sys を読むと環境（ローカル / CI / 本番）で値が変わり、
  # 何も固定できない。読み取った内容の解釈だけをここで固める。
  def stub_cgroup(current: 314_572_800, max: "536870912", anon: 209_715_200, file: 104_857_600)
    allow(File).to receive(:read).with(described_class::CURRENT_PATH).and_return("#{current}\n")
    allow(File).to receive(:read).with(described_class::MAX_PATH).and_return("#{max}\n")
    allow(File).to receive(:read).with(described_class::STAT_PATH)
      .and_return("anon #{anon}\nfile #{file}\nslab 1234\n")
  end

  def stub_processes(entries)
    allow(Dir).to receive(:glob).with("/proc/[0-9]*").and_return(entries.keys)

    entries.each do |dir, (name, rss_kb)|
      allow(File).to receive(:read).with("#{dir}/status").and_return("Name:\tx\nVmRSS:\t#{rss_kb} kB\n")
      allow(File).to receive(:read).with("#{dir}/cmdline").and_return(name.split(" ").join("\0"))
    end
  end

  before do
    stub_cgroup
    stub_processes({})
  end

  it "cgroup の値をメガバイトに直して返す" do
    result = described_class.call

    expect(result).to include(used_mb: 300, limit_mb: 512, anon_mb: 200, file_mb: 100)
  end

  # 上限が無い環境（ローカルの docker compose）では memory.max が "max" になる。
  it "上限が max のときは limit_mb を nil にする" do
    stub_cgroup(max: "max")

    expect(described_class.call[:limit_mb]).to be_nil
  end

  # macOS で直接動かした場合など、cgroup が無い環境ではキーごと省けるように nil を返す。
  it "cgroup を読めない環境では nil を返す" do
    allow(File).to receive(:read).with(described_class::CURRENT_PATH).and_raise(Errno::ENOENT)

    expect(described_class.call).to be_nil
  end

  describe "プロセスの内訳" do
    it "使用量の多い順に並べる" do
      stub_processes(
        "/proc/1" => [ "puma 8.0.2", 51_200 ],
        "/proc/2" => [ "solid-queue-worker(1.5.1)", 102_400 ]
      )

      expect(described_class.call[:processes]).to eq(
        [ { name: "solid-queue-worker(1.5.1)", mb: 100 }, { name: "puma 8.0.2", mb: 50 } ]
      )
    end

    # 判定は表示する値（丸めた MB）で行う。512 kB のように 1 MB に丸まるものは残す。
    it "1 MB 未満に丸まるプロセスは省く" do
      stub_processes("/proc/1" => [ "sh", 200 ], "/proc/2" => [ "puma", 51_200 ])

      expect(described_class.call[:processes].map { |process| process[:name] }).to eq([ "puma" ])
    end

    # 読んでいる最中に終了するプロセスがある。1 つ失敗しても全体を落とさない。
    it "途中で消えたプロセスは飛ばす" do
      stub_processes("/proc/1" => [ "puma", 51_200 ])
      allow(Dir).to receive(:glob).with("/proc/[0-9]*").and_return([ "/proc/1", "/proc/999" ])
      allow(File).to receive(:read).with("/proc/999/status").and_raise(Errno::ENOENT)

      expect(described_class.call[:processes]).to eq([ { name: "puma", mb: 50 } ])
    end

    it "VmRSS を持たない行（カーネルスレッド等）は飛ばす" do
      allow(Dir).to receive(:glob).with("/proc/[0-9]*").and_return([ "/proc/1" ])
      allow(File).to receive(:read).with("/proc/1/status").and_return("Name:\tkthreadd\n")

      expect(described_class.call[:processes]).to be_empty
    end
  end
end
