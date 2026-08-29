import { m } from '~/paraglide/messages'

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto max-w-6xl px-4 py-8 text-xs text-muted-foreground">
        <p className="font-heading text-sm text-foreground">{m.site_name()}</p>
        <p className="mt-2 max-w-prose leading-5">{m.footer_disclaimer()}</p>
      </div>
    </footer>
  )
}
