import { RiArrowDownSLine } from "@remixicon/react";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

/** Agent/Schedule configuration choices retain unknown saved identities until explicitly changed. */
export function ConfigurationChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="compact"
            disabled={disabled}
            aria-label={`${label}: ${options[value] ?? "Unavailable selection"}`}
            className="min-w-32 justify-between"
          />
        }
      >
        {options[value] ?? "Unavailable selection"}
        <RiArrowDownSLine data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-64 overflow-y-auto"
      >
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => onChange(next as T)}
          >
            {Object.entries<string>(options).map(([id, title]) => (
              <DropdownMenuRadioItem key={id} value={id} closeOnClick>
                {title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
