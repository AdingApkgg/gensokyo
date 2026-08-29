import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SakuraScene } from "@/components/sakura-scene";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SakuraScene />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
