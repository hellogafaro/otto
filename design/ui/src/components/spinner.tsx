import { cn } from "cn"
import { LoaderIcon } from "lucide-react"

// Otto: the one loading indicator, 14px like every icon (never a text label).
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <LoaderIcon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-3.5 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
