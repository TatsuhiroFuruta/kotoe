class CreateLikes < ActiveRecord::Migration[8.1]
  def change
    create_table :likes do |t|
      t.references :user, null: false, foreign_key: true
      t.references :attempt, null: false, foreign_key: true

      t.timestamps
    end
    add_index :likes, [ :user_id, :attempt_id ], unique: true
  end
end
