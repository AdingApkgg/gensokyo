"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { LogIn, LogOut, User as UserIcon, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type SimpleUser = { name?: string | null; email?: string | null; image?: string | null };

export function UserMenu({ user }: { user: SimpleUser | null }) {
  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/login"><LogIn className="size-4" />登录</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="gap-1.5 hidden sm:inline-flex">
          <Link href="/register"><UserPlus className="size-4" />注册</Link>
        </Button>
      </div>
    );
  }
  const initial = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <Avatar className="size-8">
            {user.image && <AvatarImage src={user.image} alt={user.name ?? ""} />}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="font-medium truncate">{user.name ?? "用户"}</span>
          <span className="text-xs text-muted-foreground truncate">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/me"><UserIcon className="size-4" />个人中心</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  window.location.href = "/";
                },
              },
            })
          }
        >
          <LogOut className="size-4" />退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
