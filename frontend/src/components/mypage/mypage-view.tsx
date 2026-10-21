"use client";

import { MypageList } from "@/components/mypage/mypage-list";
import { MypageTabs } from "@/components/mypage/mypage-tabs";
import { ProfileHeader } from "@/components/mypage/profile-header";
import { useAuth } from "@/lib/auth/auth-context";
import type { MypageQuery } from "@/lib/mypage/mypage-query";

export function MypageView({ query }: { query: MypageQuery }) {
  const auth = useAuth();

  // RequireAuth の内側なので authenticated 以外はここに来ない。型を絞るための分岐。
  if (auth.status !== "authenticated") return null;

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader name={auth.user.name} />
      <MypageTabs current={query.tab} />
      <MypageList query={query} />
    </div>
  );
}
