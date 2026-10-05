import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@workspace/ui/components/breadcrumb'

export interface PanelCrumb {
  icon?: React.ComponentType<{ className?: string }>
  label: string
  /** Where the crumb goes; the last crumb is the current page and needs none */
  onClick?: () => void
}

/**
 * The header's breadcrumb: small (28px) ghost buttons with their icons, the last one
 * the current page. Earlier crumbs navigate.
 */
export function PanelBreadcrumb({ crumbs }: { crumbs: PanelCrumb[] }) {
  return (
    <Breadcrumb className="titlebar-no-drag min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1
          const Icon = crumb.icon
          return (
            <React.Fragment key={`${index}-${crumb.label}`}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className={current ? 'min-w-0 text-foreground' : 'text-muted-foreground'}
                  aria-current={current ? 'page' : undefined}
                  onClick={current ? undefined : crumb.onClick}
                >
                  {Icon && <Icon className="size-3.5" />}
                  <span className="truncate">{crumb.label}</span>
                </Button>
              </BreadcrumbItem>
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
