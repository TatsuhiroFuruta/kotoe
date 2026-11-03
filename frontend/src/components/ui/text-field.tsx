import type { Ref } from "react";

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
  /** 必須か。既定は必須。任意の欄だけ false にする */
  required?: boolean;
  /** 文字数の表示。渡すと入力欄の下に「現在 / 上限」を出し、aria-describedby で結ぶ */
  counter?: { length: number; max: number };
  /**
   * 入力欄そのものへの参照。エラーのときに入力欄へフォーカスを移すために使う（7-5）。
   * React 19 では ref を普通の prop として受け取れるので forwardRef は要らない。
   */
  ref?: Ref<HTMLInputElement>;
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
  required = true,
  counter,
  ref,
}: TextFieldProps) {
  const errorId = `${id}-error`;
  const counterId = `${id}-counter`;
  const describedBy =
    [error === undefined ? null : errorId, counter === undefined ? null : counterId]
      .filter((value) => value !== null)
      .join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy}
        className="rounded-card border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
      />
      {(error !== undefined || counter !== undefined) && (
        <div className="flex items-start justify-between gap-3 text-sm">
          {error !== undefined ? (
            <p id={errorId} className="text-danger">
              {error}
            </p>
          ) : (
            <span />
          )}
          {/*
            表示だけ。判定はサーバーの 422 に任せ、aria-live にしない（1 文字ごとに読み上げられる）。
            length は UTF-16 の単位なので絵文字などでサーバーより多く数えることがあるが、
            多めの側のずれなので「超えていない」表示で 422 になることは無い。
            attempt-composer.tsx の文字数表示と同じ理由。
          */}
          {counter !== undefined && (
            <p
              id={counterId}
              className={`shrink-0 tabular-nums ${counter.length > counter.max ? "text-danger" : "text-ink-muted"}`}
            >
              {counter.length} / {counter.max}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
