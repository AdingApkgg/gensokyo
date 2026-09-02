import { ChevronLeft, ChevronRight } from 'lucide-react'
import type * as React from 'react'
import { Link } from 'react-router'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages'

function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      aria-label="pagination"
      data-slot="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  )
}
function PaginationContent({
  className,
  ...props
}: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn('flex flex-row items-center gap-1', className)}
      {...props}
    />
  )
}
function PaginationItem(props: React.ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />
}

type LinkProps = {
  to: string
  isActive?: boolean
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}

function PaginationLink({
  to,
  isActive,
  disabled,
  className,
  children,
}: LinkProps) {
  if (disabled) {
    return (
      <span
        aria-disabled
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          'pointer-events-none opacity-50',
          className,
        )}
      >
        {children}
      </span>
    )
  }
  return (
    <Link
      to={to}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        buttonVariants({ variant: isActive ? 'outline' : 'ghost', size: 'sm' }),
        className,
      )}
      preventScrollReset
    >
      {children}
    </Link>
  )
}
function PaginationPrevious(props: Omit<LinkProps, 'children'>) {
  return (
    <PaginationLink {...props}>
      <ChevronLeft />
      <span className="hidden sm:inline">{m.shrine_prev_page()}</span>
    </PaginationLink>
  )
}
function PaginationNext(props: Omit<LinkProps, 'children'>) {
  return (
    <PaginationLink {...props}>
      <span className="hidden sm:inline">{m.shrine_next_page()}</span>
      <ChevronRight />
    </PaginationLink>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
