require "rails_helper"

RSpec.describe Diagnostics::Memory do
  # 実際の /proc や /sys を読むと環境（ローカル / CI / 本番）で値が変わり、
  # 何も固定できない。読み取った内容の解釈だけをここで固める。
  #
  # 既定は「どのパスも読めない」状態。各 example が必要なものだけ生やす。
  before do
    allow(File).to receive(:read).and_raise(Errno::ENOENT)
    allow(Dir).to receive(:glob).with("/proc[0-9]*").and_return([])
    allow(Dir).to receive(:glob).with("/proc/[0-9]*").and_return([])
  end

  def stub_file(path, content)
    allow(File).to receive(:read).with(path).and_return(content)
  end

  def stub_v2(current: 314_572_800, max: "536870912", anon: 209_715_200, file: 104_857_600)
    stub_file(described_class::V2_CURRENT, "#{current}\n")
    stub_file(described_class::V2_MAX, "#{max}\n")
    stub_file(described_class::V2_STAT, "anon #{anon}\nfile #{file}\nslab 1234\n")
  end

  def stub_v1(current: 209_715_200, max: "536870912", rss: 157_286_400, cache: 52_428_800)
    stub_file(described_class::V1_CURRENT, "#{current}\n")
    stub_file(described_class::V1_MAX, "#{max}\n")
    stub_file(described_class::V1_STAT, "cache #{cache}\nrss #{rss}\n")
  end

  def stub_processes(entries)
    allow(Dir).to receive(:glob).with("/proc/[0-9]*").and_return(entries.keys)

    entries.each do |dir, (name, rss_kb)|
      stub_file("#{dir}/status", "Name:\tx\nVmRSS:\t#{rss_kb} kB\n")
      stub_file("#{dir}/cmdline", name.split(" ").join("\0"))
    end
  end

  describe "取得元の選択" do
    it "cgroup v2 が読めればそれを使う" do
      stub_v2
      stub_v1

      expect(described_class.call).to include(
        source: "cgroup_v2", used_mb: 300, limit_mb: 512, anon_mb: 200, file_mb: 100
      )
    end

    # Render では v2 のパスが読めなかった。
    it "v2 が読めなければ v1 を使う" do
      stub_v1

      expect(described_class.call).to include(
        source: "cgroup_v1", used_mb: 200, limit_mb: 512, anon_mb: 150, file_mb: 50
      )
    end

    # 合計は共有ページを二重に数えるため実使用量より大きい。source で区別できるようにする。
    it "cgroup が読めなければ /proc の RSS 合計に落ちる" do
      stub_processes("/proc/1" => [ "puma", 102_400 ], "/proc/2" => [ "worker", 51_200 ])

      expect(described_class.call).to include(source: "proc_rss", used_mb: 150, limit_mb: nil)
    end

    it "どれも読めなければ nil を返す" do
      expect(described_class.call).to be_nil
    end
  end

  describe "上限の扱い" do
    # ローカルの docker compose はこれ。
    it "v2 の max は上限なしとして nil にする" do
      stub_v2(max: "max")

      expect(described_class.call[:limit_mb]).to be_nil
    end

    # v1 は上限なしを巨大な数値で表す。
    it "v1 の巨大な値は上限なしとして nil にする" do
      stub_v1(max: "9223372036854771712")

      expect(described_class.call[:limit_mb]).to be_nil
    end
  end

  describe "プロセスの内訳" do
    it "使用量の多い順に並べる" do
      stub_v2
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
      stub_v2
      stub_processes("/proc/1" => [ "sh", 200 ], "/proc/2" => [ "puma", 51_200 ])

      expect(described_class.call[:processes].map { |process| process[:name] }).to eq([ "puma" ])
    end

    # 読んでいる最中に終了するプロセスがある。1 つ失敗しても全体を落とさない。
    it "途中で消えたプロセスは飛ばす" do
      stub_v2
      stub_processes("/proc/1" => [ "puma", 51_200 ])
      allow(Dir).to receive(:glob).with("/proc/[0-9]*").and_return([ "/proc/1", "/proc/999" ])

      expect(described_class.call[:processes]).to eq([ { name: "puma", mb: 50 } ])
    end

    it "VmRSS を持たない行（カーネルスレッド等）は飛ばす" do
      stub_v2
      allow(Dir).to receive(:glob).with("/proc/[0-9]*").and_return([ "/proc/1" ])
      stub_file("/proc/1/status", "Name:\tkthreadd\n")

      expect(described_class.call[:processes]).to be_empty
    end
  end
end
