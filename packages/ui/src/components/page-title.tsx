import { cn } from "cn";

// Otto: page and account headings share the title token and medium weight.
function PageTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 className={cn("text-lg font-medium", className)} {...props} />;
}

export { PageTitle };
