import { Avatar } from "@heroui/react";

export interface MeUser {
  username: string;
  role: string;
}

export function UserProfileCard({ user }: { user: MeUser }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <Avatar>
        <Avatar.Fallback delayMs={600}>{user.username.slice(0, 2).toUpperCase()}</Avatar.Fallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {user.username}
        </div>
        <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">{user.role}</div>
      </div>
    </div>
  );
}
