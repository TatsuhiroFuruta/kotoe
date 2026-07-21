class AddDeviseToUsers < ActiveRecord::Migration[8.1]
  def change
    # default: "" は devise の generator が生成する形に合わせている。
    add_column :users, :email, :string, null: false, default: ""
    add_column :users, :encrypted_password, :string, null: false, default: ""

    add_index :users, :email, unique: true
  end
end
