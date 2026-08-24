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
#
# その削除済みのお題では、タイトルと画像を伏せて id と discarded だけにする。
# discard はモデレーションの取り下げ手段でもあり（通報 → ソフトデリート）、伏せないと
# 取り下げた画像の public_id を、そのお題に挑戦した全員のマイページから配り続けることに
# なる。Cloudinary の URL は public_id から誰でも組み立てられるため。
# カードに残る操作は DELETE /api/attempts/:id だけなので、この 2 つで足りる。
class PostSummarySerializer
  def self.call(post)
    discarded = post.discarded?

    {
      id: post.id,
      title: discarded ? nil : post.title,
      image_public_id: discarded ? nil : post.image_public_id,
      discarded: discarded
    }
  end
end
