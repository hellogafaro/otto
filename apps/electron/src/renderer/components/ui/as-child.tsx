import * as React from 'react'

/**
 * Radix's `asChild` for Base UI parts. Base UI takes the element to render as a
 * `render` prop; this turns `<Trigger asChild><button/></Trigger>` into
 * `<Trigger render={<button/>} />` so existing call sites keep working.
 */
export function asChildProps<P extends { children?: React.ReactNode }>(
  props: P & { asChild?: boolean },
): Omit<P, 'children'> & { children?: React.ReactNode; render?: React.ReactElement } {
  const { asChild, children, ...rest } = props
  if (asChild && React.isValidElement(children)) return { ...rest, render: children }
  return { ...rest, children }
}
