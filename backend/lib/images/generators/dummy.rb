module Images
  module Generators
    # 実費のかからないダミー。ローカル / CI / E2E（8-1）はこちらで回る。
    #
    # 8-1 の E2E はコアループ（ログイン→描写→生成→比較）を回すため、実APIだと
    # テストのたびに課金され、生成に最大2分かかってテストが遅く不安定になる。
    #
    # 契約は Openai と同じ。「読み出し位置が先頭の File を yield し、ブロックの
    # 戻り値を返す」。ジョブから両者の区別がつかないことが、ローカルと本番で
    # 同じ経路を通すための条件になる。
    class Dummy
      # lib/assets は Zeitwerk の対象外（config.autoload_lib の ignore）。
      IMAGE_PATH = Rails.root.join("lib/assets/dummy_generated.png")

      def self.call(_prompt, &block) = File.open(IMAGE_PATH, "rb", &block)
    end
  end
end
