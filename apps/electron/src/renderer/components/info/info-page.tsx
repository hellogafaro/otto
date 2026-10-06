/**
 * Info_Page
 *
 * Compound page layout component for Info pages.
 * Handles loading, error, and empty states with consistent styling.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'
import { PageHeader, type PageHeaderProps } from '@/components/app-shell/page-header'
import { PageColumn } from '@workspace/ui/components/page'
import { Spinner } from '@otto/ui'
import { cn } from '@/lib/utils'

export interface Info_PageProps {
  children: React.ReactNode
  /** Show loading spinner */
  loading?: boolean
  /** Show error state with message */
  error?: string
  /** Show empty state with message */
  empty?: string
  className?: string
}

export interface Info_PageHeaderProps extends Omit<PageHeaderProps, 'className'> {
  className?: string
}

export interface Info_PageContentProps {
  children: React.ReactNode
  className?: string
}

function Info_PageRoot({
  children,
  loading,
  error,
  empty,
  className,
}: Info_PageProps) {
  const { t } = useTranslation()
  // Extract header from children for consistent structure
  let header: React.ReactNode = null
  const otherChildren: React.ReactNode[] = []

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === Info_PageHeader) {
      header = child
    } else {
      otherChildren.push(child)
    }
  })

  // Loading state
  if (loading) {
    return (
      <div className={cn('h-full flex flex-col', className)}>
        {header}
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="text-lg text-muted-foreground" />
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={cn('h-full flex flex-col', className)}>
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-medium">{t('common.errorLoadingContent')}</p>
          <p className="text-xs text-center max-w-md">{error}</p>
        </div>
      </div>
    )
  }

  // Empty state
  if (empty) {
    return (
      <div className={cn('h-full flex flex-col', className)}>
        {header}
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">{empty}</p>
        </div>
      </div>
    )
  }

  // Normal content
  return (
    <div className={cn('h-full flex flex-col', className)}>
      {header}
      {otherChildren}
    </div>
  )
}

function Info_PageHeader({ className, ...props }: Info_PageHeaderProps) {
  return <PageHeader className={className} {...props} />
}

// The page's column: the header's title row (and the item's description) first,
// then the sections, scrolling as a whole (the title scrolls away with it).
// Settings' roomy column (`padded`), as on every settings page: a skill and a
// source live in Settings, and the floating navigation follows the title down.
function Info_PageContent({ children, className }: Info_PageContentProps) {
  return <PageColumn padded className={className}>{children}</PageColumn>
}

export const Info_Page = Object.assign(Info_PageRoot, {
  Header: Info_PageHeader,
  Content: Info_PageContent,
})
