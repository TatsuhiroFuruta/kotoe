# kaminari が持つページ情報を meta として返す。
#
# total_count の既定の集計列は :all（＝ COUNT(*)）なので、Post.with_counts が
# 足した独自 SELECT を巻き込まずに数えられる。
class PaginationSerializer
  def self.call(relation)
    {
      current_page: relation.current_page,
      total_pages: relation.total_pages,
      total_count: relation.total_count
    }
  end
end
