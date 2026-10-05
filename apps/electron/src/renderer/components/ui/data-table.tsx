import * as React from 'react'
import type {
  ColumnDef,
  ColumnSizingState,
  SortingState,
  PaginationState,
  ExpandedState,
  Column,
  Row,
  Table as TableInstance,
} from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Custom class for the table container */
  className?: string
  /** Empty state content */
  emptyContent?: React.ReactNode
  /** Callback to get table instance for external control */
  onTableReady?: (table: TableInstance<TData>) => void
  /** Skip the border wrapper (when parent provides it) */
  noBorder?: boolean
  /** Skip the table overflow wrapper (required for sticky headers) */
  noWrapper?: boolean
  /** Enable pagination */
  pagination?: boolean
  /** Page size when pagination is enabled (default: 50) */
  pageSize?: number
  /**
   * Enable tree/hierarchical rows. Provide a function that returns child rows.
   * When set, rows can be expanded/collapsed. All rows start expanded by default.
   */
  getSubRows?: (row: TData) => TData[] | undefined
  /** Initial expanded state (default: all expanded when getSubRows is provided) */
  defaultExpanded?: boolean
}

export function DataTable<TData, TValue>({
  columns,
  data,
  className,
  emptyContent,
  onTableReady,
  noBorder = false,
  noWrapper = false,
  pagination: paginationEnabled = false,
  pageSize = 50,
  getSubRows,
  defaultExpanded = true,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({})
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })
  // Tree expand state: default to all expanded when getSubRows is provided
  const [expanded, setExpanded] = React.useState<ExpandedState>(
    getSubRows && defaultExpanded ? true : {}
  )

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(paginationEnabled && { getPaginationRowModel: getPaginationRowModel() }),
    // Tree/expand support: only enabled when getSubRows is provided
    ...(getSubRows && { getExpandedRowModel: getExpandedRowModel(), getSubRows }),
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    ...(paginationEnabled && { onPaginationChange: setPagination }),
    ...(getSubRows && { onExpandedChange: setExpanded }),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      sorting,
      columnSizing,
      ...(paginationEnabled && { pagination }),
      ...(getSubRows && { expanded }),
    },
  })

  // Expose table instance
  React.useEffect(() => {
    onTableReady?.(table)
  }, [table, onTableReady])

  const tableContent = (
    <Table noWrapper={noWrapper}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const meta = header.column.columnDef.meta as
                | { fillWidth?: boolean; truncate?: boolean; maxWidth?: string }
                | undefined
              const minSize = header.column.columnDef.minSize
              const currentSize = header.getSize()
              // Only apply explicit width if user has resized or there's a minSize
              const hasResized = columnSizing[header.id] !== undefined
              return (
                <TableHead
                  key={header.id}
                  className={cn(meta?.fillWidth && 'w-full')}
                  style={{
                    width: hasResized ? currentSize : undefined,
                    minWidth: minSize,
                    maxWidth: meta?.maxWidth,
                  }}
                >
                  <div className="flex items-center">
                    <div className="flex-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </div>
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={cn(
                          'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
                          'opacity-0 hover:opacity-100 transition-opacity',
                          'bg-border',
                          header.column.getIsResizing() && 'opacity-100 bg-primary'
                        )}
                      />
                    )}
                  </div>
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() && 'selected'}
            >
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as
                  | { fillWidth?: boolean; truncate?: boolean; maxWidth?: string }
                  | undefined
                const minSize = cell.column.columnDef.minSize
                const currentSize = cell.column.getSize()
                const hasResized = columnSizing[cell.column.id] !== undefined
                return (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      meta?.fillWidth && 'w-full',
                      meta?.truncate && 'overflow-hidden'
                    )}
                    style={{
                      width: hasResized ? currentSize : undefined,
                      minWidth: minSize,
                      maxWidth: meta?.maxWidth,
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                )
              })}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="h-24 text-center"
            >
              {emptyContent ?? 'No results.'}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )

  const paginationControls = paginationEnabled && table.getPageCount() > 1 && (
    <div className="flex items-center justify-between px-2 py-3 border-t border-border">
      <div className="text-sm text-muted-foreground">
        {table.getPrePaginationRowModel().rows.length} total
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="compact"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
        </span>
        <Button
          variant="outline"
          size="compact"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  )

  if (noBorder) {
    return (
      <div className={cn('w-full', className)}>
        {tableContent}
        {paginationControls}
      </div>
    )
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="rounded-md border">
        {tableContent}
        {paginationControls}
      </div>
    </div>
  )
}

/**
 * Sortable column header component
 * Use in column definitions: header: ({ column }) => <SortableHeader column={column} title="Name" />
 */
interface SortableHeaderProps<TData, TValue> {
  column: Column<TData, TValue>
  title: string
  className?: string
}

export function SortableHeader<TData, TValue>({
  column,
  title,
  className,
}: SortableHeaderProps<TData, TValue>) {
  return (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      className={cn('w-full justify-start', className)}
    >
      {title}
    </Button>
  )
}

export type { ColumnDef, Column, Row, TableInstance }
