import { RiArrowDownSLine, RiChat1Line } from "@remixicon/react";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

export function NativeChatRecipients({
  agents,
  value,
  onChange,
  disabled,
}: {
  agents: { id: string; title: string }[];
  value: string[] | undefined;
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const selected = value ?? (agents.length === 1 ? [agents[0].id] : []);
  const label =
    value === undefined && agents.length > 1
      ? "Choose recipients"
      : selected.length === 0
        ? "Human only"
        : selected.length === 1
          ? (agents.find((agent) => agent.id === selected[0])?.title ??
            "Unavailable agent")
          : `${selected.length} agents`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="plain" size="compact" />}
        disabled={disabled}
        aria-label={`Send to: ${label}`}
      >
        <RiChat1Line />
        {label}
        <RiArrowDownSLine data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onChange([])}>
            Human only
          </DropdownMenuItem>
          {agents.map((agent) => (
            <DropdownMenuCheckboxItem
              key={agent.id}
              checked={selected.includes(agent.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...selected, agent.id]
                    : selected.filter((id) => id !== agent.id),
                )
              }
            >
              {agent.title}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
