module Diagnostics
  # コンテナ全体のメモリ使用量。
  #
  # Render の無料プランは Metrics が見られず、シェル（SSH・ダッシュボードのシェル）も
  # 有料インスタンス限定なので、外から測る手段が無い。アプリ自身に測らせる
  # （issue 4-2 の「Render 無料枠のメモリ実測」）。
  #
  # 512 MB の上限は**コンテナ全体**（Puma・supervisor・dispatcher・worker・scheduler）に
  # かかるため、プロセス単体の RSS では答えにならない。プラットフォームが見ているのと
  # 同じ値を cgroup から読む。プロセスごとの内訳は「どれが太っているか」を見るための
  # 補助で、fork したプロセスは共有ページを二重に数えるため合計は used_mb を超える。
  class Memory
    # cgroup v2 のパス。Render も docker compose もこちら。
    CURRENT_PATH = "/sys/fs/cgroup/memory.current"
    MAX_PATH = "/sys/fs/cgroup/memory.max"
    STAT_PATH = "/sys/fs/cgroup/memory.stat"

    # 内訳に出す下限。1 MB 未満のプロセス（sh など）は読みづらくなるだけなので落とす。
    MIN_PROCESS_MB = 1

    def self.call = new.call

    # @return [Hash, nil] cgroup を読めない環境（macOS で直接動かした場合など）では nil。
    #   呼び出し側はキーごと省いてよい。
    def call
      used = read_bytes(CURRENT_PATH)
      return nil if used.nil?

      {
        used_mb: to_mb(used),
        # anon はプロセスが実際に掴んでいるメモリ。file（ページキャッシュ）は
        # 逼迫すれば OS が捨てられるので、上限への近さを見るならこちらを読む。
        anon_mb: to_mb(stat["anon"]),
        file_mb: to_mb(stat["file"]),
        limit_mb: to_mb(read_bytes(MAX_PATH)),
        processes: processes
      }
    end

    private

    def processes
      Dir.glob("/proc/[0-9]*")
         .filter_map { |dir| process_at(dir) }
         .select { |process| process[:mb] >= MIN_PROCESS_MB }
         .sort_by { |process| -process[:mb] }
    end

    # 読んでいる最中に終了するプロセスがあるため、失敗は握って飛ばす。
    def process_at(dir)
      rss_kb = File.read("#{dir}/status")[/^VmRSS:\s+(\d+) kB/, 1]
      return nil if rss_kb.nil?

      { name: process_name(dir), mb: (rss_kb.to_i / 1024.0).round }
    rescue SystemCallError
      nil
    end

    # プロセスタイトルをそのまま使う。Puma も Solid Queue も役割が分かる形で
    # 設定している（"puma 8.0.2 ..." / "solid-queue-worker(1.5.1): ..."）。
    def process_name(dir)
      # cmdline は引数を NUL 区切りで持つので、空白に置き換えて 1 行にする。
      cmdline = File.read("#{dir}/cmdline").tr("\0", " ").strip

      cmdline.empty? ? "?" : cmdline[0, 60]
    end

    def stat
      @stat ||= File.read(STAT_PATH).lines.to_h { |line| line.split.first(2) }
                    .transform_values(&:to_i)
    rescue SystemCallError
      @stat = {}
    end

    # memory.max は上限が無いとき "max" という文字列になる（ローカルはこれ）。
    def read_bytes(path)
      value = File.read(path).strip

      value == "max" ? nil : value.to_i
    rescue SystemCallError
      nil
    end

    def to_mb(bytes) = bytes && (bytes / 1024.0 / 1024).round
  end
end
