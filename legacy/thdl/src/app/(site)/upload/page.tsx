import { redirect } from "next/navigation";
import { getSession } from "@/lib/get-session";
import { UploadForm } from "@/components/upload-form";

export const metadata = { title: "上传资源" };

export default async function UploadPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login?callbackUrl=/upload");
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">上传资源</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        先发后审。恶意、侵权或违反东方社区规范的内容会被下架。
      </p>
      <UploadForm />
    </div>
  );
}
