import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "登录" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="container mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">登录</h1>
      <p className="mt-1 text-sm text-muted-foreground">欢迎回到幻想乡</p>
      <div className="mt-6 rounded-2xl border bg-card/80 p-6 backdrop-blur">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
