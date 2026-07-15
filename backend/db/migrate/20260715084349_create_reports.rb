class CreateReports < ActiveRecord::Migration[8.1]
  def change
    create_table :reports do |t|
      t.references :reporter, null: false, foreign_key: { to_table: :users }
      t.references :attempt, null: false, foreign_key: true
      t.string :reason, null: false
      t.datetime :discarded_at

      t.timestamps
    end
    add_index :reports, :discarded_at
  end
end
