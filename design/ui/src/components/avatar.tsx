import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"
import { cn } from "cn"

// Otto: initials are ~40% of the avatar. 20px (sm) is the smallest avatar;
// lists that mix avatars with icons give the icons a 20px slot instead.
// Rounded squares, not circles (like Slack): 20px xs 4, 28px (md, chat
// messages) sm 6, 32px md 8, 40px lg 10, about a quarter of the side; image,
// fill and ring follow the corner.
function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "default" | "sm" | "md" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 rounded-md select-none data-[size=lg]:rounded-lg data-[size=md]:size-7 data-[size=md]:rounded-sm data-[size=sm]:rounded-xs after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-5 dark:after:mix-blend-lighten",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "aspect-square size-full rounded-[inherit] object-cover",
        className
      )}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-[inherit] bg-muted text-xs text-muted-foreground group-data-[size=lg]/avatar:text-sm group-data-[size=sm]/avatar:text-[0.5rem] [&>svg]:size-4 group-data-[size=sm]/avatar:[&>svg]:size-3 group-data-[size=md]/avatar:[&>svg]:size-3.5 group-data-[size=lg]/avatar:[&>svg]:size-5",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

// Otto: 20px (sm) avatars overlap 4px, the same share as stock 32px ones.
function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 has-data-[size=sm]:-space-x-1 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=sm]/avatar-group:rounded-xs group-has-data-[size=lg]/avatar-group:rounded-lg group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-5 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
}
