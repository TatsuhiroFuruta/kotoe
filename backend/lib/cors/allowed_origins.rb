module Cors
  # CORS で許可するオリジンの判定。
  #
  # 許可の指定は 2 通り：
  #   - CORS_ALLOWED_ORIGINS      … カンマ区切りの完全一致リスト（本番ドメイン、ローカル）
  #   - CORS_ALLOWED_ORIGIN_REGEX … 正規表現 1 本（Vercel のプレビューURLはデプロイごとに変わるため）
  #
  # config/initializers/cors.rb から 1 リクエストにつき 1 回呼ばれる。
  class AllowedOrigins
    ORIGINS_ENV_KEY = "CORS_ALLOWED_ORIGINS".freeze
    PATTERN_ENV_KEY = "CORS_ALLOWED_ORIGIN_REGEX".freeze

    class << self
      # ENV 由来のインスタンス。設定は起動後に変わらないのでメモ化する。
      def current
        @current ||= from_env
      end

      def from_env(env = ENV)
        new(
          origins: env.fetch(ORIGINS_ENV_KEY, "").split(","),
          pattern: env[PATTERN_ENV_KEY]
        )
      end
    end

    # @param origins [Array<String>] 完全一致で許可するオリジン
    # @param pattern [String, nil] 許可するオリジンの正規表現（\A \z は付けなくてよい）
    def initialize(origins:, pattern: nil)
      @origins = normalize(origins)
      @pattern = compile(pattern)
    end

    def allow?(origin)
      return false if origin.blank?

      @origins.include?(origin) || matches_pattern?(origin)
    end

    # 完全一致リスト・正規表現のどちらも未設定なら false。
    # 起動時のフェイルファスト（config/initializers/cors.rb）で使う。
    def configured?
      @origins.any? || @pattern.present?
    end

    private

    def normalize(origins)
      origins.map { |origin| origin.to_s.strip.delete_suffix("/") }.reject(&:empty?)
    end

    # 前後を \A \z で囲んでからコンパイルする。
    # Ruby の ^ / $ は行頭・行末にマッチするため、設定値に書かせると
    # 改行を含むオリジンで意図しないマッチが起きうる。実装側で保証する。
    #
    # 非捕獲グループ (?:...) で括ってから \A \z を付ける。
    # | はRubyの正規表現で最も優先順位が低いため、括らずに \A#{pattern}\z と
    # すると、pattern 側の | の右辺・左辺にしか \A \z がかからず、
    # 「先頭ブランチ + 末尾に任意の文字列」のようなオリジンを通してしまう。
    def compile(pattern)
      return nil if pattern.blank?

      Regexp.new("\\A(?:#{pattern})\\z")
    end

    def matches_pattern?(origin)
      return false if @pattern.nil?

      @pattern.match?(origin)
    end
  end
end
