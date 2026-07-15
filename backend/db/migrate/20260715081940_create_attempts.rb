class CreateAttempts < ActiveRecord::Migration[8.1]
  def change
    create_table :attempts do |t|
      t.references :post, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.text :description, null: false
      t.string :generated_image_public_id
      t.integer :similarity_score
      t.string :status, null: false, default: "draft"
      t.datetime :discarded_at

      t.timestamps
    end
    add_index :attempts, :discarded_at
  end
end
