module Diagnostics
  # コンテナ全体のメモリ使用量。
  #
  # Render の無料プランは Metrics が見られず、シェル（SSH・ダッシュボードのシェル）も
  # 有料インスタンス限定なので、外から測る手段が無い。アプリ自身に測らせる
  # （issue 4-2 の「Render 無料枠のメモリ実測」）。
  #
  # 512 MB の上限は**コンテナ全体**（Puma・supervisor・dispatcher・worker・scheduler）に
  # かかるため、プロセス単体の RSS では答えにならない。
  #
  # used_mb は**測ったその瞬間**の値なので、生成ジョブのピークは取りこぼす。カーネルが
  # 記録している最大値（peak_mb）も一緒に返す。**コンテナ起動時からの最大値**で、
  # リクエストのたびにリセットされたりはしない。「512 MB にどこまで近づいたか」を
  # 後から知りたいときはこちらを見る（issue 4-3 で画像生成を載せるときの判断材料）。
  #
  # 取得元は環境によって違う。cgroup のバージョンもパスもプラットフォーム次第で、
  # 実際 Render では v2 のパスが読めなかった（ローカルの docker compose は読める）。
  # 3 通りを順に試し、**どれで取れたかを source として返す**。取得元によって数値の
  # 意味が変わる（後述の proc_rss）ため、値だけ見て取り違えないようにする。
  class Memory
    # cgroup v2。ローカルの docker compose はこちら。
    V2_CURRENT = "/sys/fs/cgroup/memory.current"
    V2_PEAK = "/sys/fs/cgroup/memory.peak"
    V2_MAX = "/sys/fs/cgroup/memory.max"
    V2_STAT = "/sys/fs/cgroup/memory.stat"

    # cgroup v1。
    V1_CURRENT = "/sys/fs/cgroup/memory/memory.usage_in_bytes"
    V1_PEAK = "/sys/fs/cgroup/memory/memory.max_usage_in_bytes"
    V1_MAX = "/sys/fs/cgroup/memory/memory.limit_in_bytes"
    V1_STAT = "/sys/fs/cgroup/memory/memory.stat"

    # cgroup v1 は「上限なし」を巨大な数値で表す（値は環境により違う）。
    # 実在しうるコンテナの上限を超えていたら未設定とみなす。
    UNLIMITED_THRESHOLD = 1024 * 1024 * 1024 * 1024 # 1 TiB

    # 内訳に出す下限。1 MB 未満に丸まるプロセス（sh など）は読みづらくなるだけなので落とす。
    MIN_PROCESS_MB = 1

    def self.call = new.call

    # @return [Hash, nil] cgroup も /proc も読めない環境では nil。
    #   呼び出し側はキーごと省いてよい。
    def call
      processes = collect_processes
      summary = cgroup_summary || proc_summary(processes)
      return nil if summary.nil?

      summary.merge(processes: processes)
    end

    private

    def cgroup_summary
      v2_summary || v1_summary
    end

    def v2_summary
      used = read_bytes(V2_CURRENT)
      return nil if used.nil?

      stat = read_stat(V2_STAT)

      {
        source: "cgroup_v2",
        used_mb: to_mb(used),
        peak_mb: to_mb(read_bytes(V2_PEAK)),
        # anon はプロセスが実際に掴んでいる分。file（ページキャッシュ）は逼迫すれば
        # OS が捨てられるので、上限への近さを見るならこちらを読む。
        anon_mb: to_mb(stat["anon"]),
        file_mb: to_mb(stat["file"]),
        limit_mb: to_mb(read_bytes(V2_MAX))
      }
    end

    def v1_summary
      used = read_bytes(V1_CURRENT)
      return nil if used.nil?

      stat = read_stat(V1_STAT)

      {
        source: "cgroup_v1",
        used_mb: to_mb(used),
        peak_mb: to_mb(read_bytes(V1_PEAK)),
        # v1 は名前が違うだけで、意味は v2 の anon / file と同じ。
        anon_mb: to_mb(stat["rss"]),
        file_mb: to_mb(stat["cache"]),
        limit_mb: to_mb(read_bytes(V1_MAX))
      }
    end

    # cgroup が読めないときの最後の手段。
    #
    # **fork したプロセスは共有ページを二重に数える**ので、この合計はコンテナの実使用量
    # より大きく出る。Solid Queue の supervisor / dispatcher / worker / scheduler は
    # すべて Puma からの fork なので差は小さくない。上限との厳密な比較には使えず、
    # 「どれが太っているか」と「桁の把握」に留める。source で区別できるようにしてある。
    def proc_summary(processes)
      return nil if processes.empty?

      { source: "proc_rss", used_mb: processes.sum { |process| process[:mb] }, limit_mb: nil }
    end

    def collect_processes
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

    def read_stat(path)
      File.read(path).lines.to_h { |line| line.split.first(2) }.transform_values(&:to_i)
    rescue SystemCallError
      {}
    end

    # 上限が無いとき、v2 は "max"、v1 は巨大な数値になる。どちらも nil に倒す。
    def read_bytes(path)
      value = File.read(path).strip
      return nil if value == "max"

      bytes = value.to_i
      bytes < UNLIMITED_THRESHOLD ? bytes : nil
    rescue SystemCallError
      nil
    end

    def to_mb(bytes) = bytes && (bytes / 1024.0 / 1024).round
  end
end
