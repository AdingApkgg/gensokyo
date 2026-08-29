import { RegisterForm } from "@/components/register-form";

export const metadata = { title: "注册" };

export default function RegisterPage() {
  return (
    <div className="container mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">创建账号</h1>
      <div className="mt-6 rounded-2xl border bg-card/80 p-6 backdrop-blur">
        <RegisterForm />
      </div>
    </div>
  );
}
