type TextFieldProps = {
  id: string;
  label: string;
  type: "text" | "email" | "password";
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  /** サーバーが返したこのフィールドのエラー文言 */
  error?: string;
  minLength?: number;
};

/**
 * ラベル＋入力欄＋エラー表示。
 *
 * クライアント側の検証はブラウザ標準の属性（required / type / minLength）だけに
 * 留める。ルールの正は Rails が持っており（設計書「5.」）、ここで JS の検証を
 * 足すと同じルールを 2 箇所に持つことになる。標準の属性はサーバーの規則より
 * 緩いので、サーバーが受け付ける入力を弾いてしまうことがない。
 */
export function TextField({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  error,
  minLength,
}: TextFieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        required
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        className="rounded-card border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
