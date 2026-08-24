# 挑戦アイテムに添える「どのお題への挑戦か」の最小表現。マイページの
# 「自分の挑戦」「下書き」カードが使う（サムネイル・タイトル・リンク先）。
#
# PostSerializer と違い、集計（attempts_count / likes_count）も favorited も持たない。
# カードが使わないうえ、preload した Post には with_counts が SELECT 句で付ける
# 別名属性が乗っていないため（取り直すと 2 クエリ増える）。
#
# discarded を持つのはこの表現だけ。マイページは削除済みのお題にぶら下がる自分の挑戦も
# 出すので（4-4 案A：片付ける手段を残す）、フロントが描き分けるのに要る。公開 API の
# お題一覧・詳細には削除済みが出てこないので、PostSerializer 側には足さない。
class PostSummarySerializer
  def self.call(post)
    {
      id: post.id,
      title: post.title,
      image_public_id: post.image_public_id,
      discarded: post.discarded?
    }
  end
end
