import { OTPInput, OTPInputContext } from "input-otp";
import * as React from "react";

import { cn } from "~/lib/utils";

function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string;
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn("flex items-center has-disabled:opacity-64", containerClassName)}
      spellCheck={false}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="input-otp-group" className={cn("flex items-center", className)} {...props} />
  );
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  index: number;
}) {
  const inputOTPContext = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {};

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        // Otto: Slots are the 32px default control on the input's secondary fill and soft
        // control border, with the input's focus ring on the active slot.
        "relative flex size-8 items-center justify-center border-y border-r border-control-border bg-secondary text-sm text-foreground tabular-nums transition-shadow outline-none first:rounded-l-(--control-radius) first:border-l last:rounded-r-(--control-radius) aria-invalid:border-destructive data-[active=true]:z-10 data-[active=true]:ring-2 data-[active=true]:ring-foreground/20 data-[active=true]:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground" />
        </div>
      ) : null}
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot };
