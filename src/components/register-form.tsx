"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: "/",
    });
    setPending(false);
    if (error) return toast.error(error.message ?? "注册失败");
    window.location.href = "/";
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="name">昵称</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">邮箱</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pwd">密码</Label>
        <Input id="pwd" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "创建中…" : "创建账号"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        已有账号？<Link href="/login" className="text-primary hover:underline">登录</Link>
      </p>
    </form>
  );
}
