class AddFailureReasonToAttempts < ActiveRecord::Migration[8.1]
  def change
    add_column :attempts, :failure_reason, :string
  end
end
