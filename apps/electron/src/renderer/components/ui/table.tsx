import * as React from 'react'
import {
  Table as DsTable,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead as DsTableHead,
  TableCell,
  TableCaption,
} from '@workspace/ui/components/table'
import { cn } from '@/lib/utils'

/** `noWrapper` skips the overflow-x-auto wrapper (required for sticky headers). */
function Table(props: React.ComponentProps<typeof DsTable>) {
  return <DsTable {...props} />
}

// Craft tables keep their header pinned; bg-card is always opaque (bg-background may be translucent in scenic mode).
function TableHead({ className, ...props }: React.ComponentProps<typeof DsTableHead>) {
  return <DsTableHead className={cn('sticky top-0 z-10 bg-card', className)} {...props} />
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
