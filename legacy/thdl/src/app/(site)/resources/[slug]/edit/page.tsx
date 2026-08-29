import { notFound, redirect } from "next/navigation";
import { db, resources } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/get-session";
import { EditForm } from "@/components/edit-form";

export const metadata = { title: "编辑资源" };

type Params = Promise<{ slug: string }>;

export default async function EditPage({ params }: { params: Params }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const { slug } = await params;
  const r = await db.query.resources.findFirst({
    where: eq(resources.slug, slug),
    with: { files: true },
  });
  if (!r) notFound();
  const canEdit =
    session.user.id === r.uploaderId ||
    session.user.role === "moderator" ||
    session.user.role === "admin";
  if (!canEdit) redirect(`/resources/${r.slug}`);
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">编辑资源</h1>
      <EditForm
        resource={{
          id: r.id,
          slug: r.slug,
          title: r.title,
          category: r.category,
          circle: r.circle ?? "",
          author: r.author ?? "",
          description: r.descriptionMd,
          externalLinks: r.externalLinks ?? [],
        }}
      />
    </div>
  );
}
