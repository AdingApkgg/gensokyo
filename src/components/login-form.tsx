"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const sp = useSearchParams();
  const callbackURL = sp.get("callbackUrl") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.signIn.email({ email, password, callbackURL });
    setPending(false);
    if (error) return toast.error(error.message ?? "邮箱或密码错误");
    window.location.href = callbackURL;
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pwd">密码</Label>
          <Input id="pwd" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "登录中…" : "登录"}
        </Button>
      </form>
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">或</span>
        <Separator className="flex-1" />
      </div>
      <div className="grid gap-2">
        <Button
          variant="outline"
          onClick={() => authClient.signIn.social({ provider: "github", callbackURL })}
        >
          GitHub
        </Button>
        <Button
          variant="outline"
          onClick={() => authClient.signIn.social({ provider: "google", callbackURL })}
        >
          Google
        </Button>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        还没账号？<Link href="/register" className="text-primary hover:underline">注册</Link>
      </p>
    </div>
  );
}
