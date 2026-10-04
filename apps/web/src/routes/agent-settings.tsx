import { RiMoreLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { NotFound } from "@/components/empty-page";
import { ItemMenuItems } from "@/components/item-menu";
import { MascotIcon, mascots } from "@/components/mascot";
import { Page } from "@/components/page";
import { nameColors, visibilityLooks } from "@/components/task-meta";
import {
  type AgentConfig,
  type AgentModel,
  agentConfigs,
  connections,
  skills,
} from "@/mock/settings";
import { type Agent, agents } from "@/mock/tasks";
import { Choice, Group, Row, useAutosave } from "@/routes/settings";

const models: Record<AgentModel, string> = {
  default: "Default (GPT-5.5)",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.5-mini": "GPT-5.5 mini",
};

// One agent's settings, like BB's: Profile (name, what it is for, its
// mascot and color, who can use it), Instructions, Model, then the Skills and
// Connections it may use. All of it saves as you go ("Agent saved"). Otto,
// the default agent, can't be deleted.
export function AgentSettingsPage({ agentId }: { agentId: string }) {
  const agent: Agent | undefined = agents[agentId as keyof typeof agents];
  const config = agentConfigs[agentId];
  if (!agent || !config) return <NotFound />;
  return <AgentSettings id={agentId} agent={agent} config={config} />;
}

function AgentSettings({
  id,
  agent,
  config,
}: {
  id: string;
  agent: Agent;
  config: AgentConfig;
}) {
  const navigate = useNavigate();
  const title = useAgentField(agent.title, (value) => {
    agent.title = value;
  });
  const description = useAgentField(agent.description, (value) => {
    agent.description = value;
  });
  const mascot = useAgentField(agent.mascot, (value) => {
    agent.mascot = value;
  });
  const color = useAgentField(agent.color, (value) => {
    agent.color = value;
  });
  const visibility = useAgentField(config.visibility, (value) => {
    config.visibility = value;
  });
  const instructions = useAgentField(config.instructions, (value) => {
    config.instructions = value;
  });
  const model = useAgentField(config.model, (value) => {
    config.model = value;
  });
  const skillIds = useAgentField(config.skillIds, (value) => {
    config.skillIds = value;
  });
  const connectionIds = useAgentField(config.connectionIds, (value) => {
    config.connectionIds = value;
  });

  return (
    <Page
      title={title.value || "Untitled agent"}
      actions={
        id !== "a_otto" && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="More" />
              }
            >
              <RiMoreLine />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <ItemMenuItems
                type="agent"
                name={title.value}
                link={`/settings/agents/${id}`}
                onDelete={() =>
                  navigate({
                    to: "/settings/$section",
                    params: { section: "agents" },
                  })
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    >
      <div className="flex flex-col gap-8">
        <Group title="Profile">
          <Row title="Name">
            <Input
              aria-label="Name"
              value={title.value}
              onChange={(event) => title.change(event.target.value)}
              onBlur={title.flush}
              className="w-56"
            />
          </Row>
          <Row title="Description" description="What it is for, in a line.">
            <Input
              aria-label="Description"
              value={description.value}
              onChange={(event) => description.change(event.target.value)}
              onBlur={description.flush}
              className="w-72"
            />
          </Row>
          <Row title="Icon">
            <div className="flex flex-wrap justify-end gap-1">
              {mascots.map((name) => (
                <Button
                  key={name}
                  variant={mascot.value === name ? "secondary" : "ghost"}
                  size="icon-compact"
                  aria-label={name}
                  aria-pressed={mascot.value === name}
                  onClick={() => mascot.change(name)}
                >
                  <MascotIcon
                    mascot={name}
                    className={cn("size-4", nameColors[color.value])}
                  />
                </Button>
              ))}
            </div>
          </Row>
          <Row title="Color">
            <div className="flex gap-1">
              {nameColors.map((className, index) => (
                <Button
                  // biome-ignore lint/suspicious/noArrayIndexKey: colors are a fixed list.
                  key={index}
                  variant={color.value === index ? "secondary" : "ghost"}
                  size="icon-compact"
                  aria-label={`Color ${index + 1}`}
                  aria-pressed={color.value === index}
                  onClick={() => color.change(index)}
                >
                  <span
                    className={cn(
                      "size-3.5 rounded-full bg-current",
                      className,
                    )}
                  />
                </Button>
              ))}
            </div>
          </Row>
          <Row title="Who can use it">
            <Choice
              label="Who can use it"
              value={visibility.value}
              options={{
                user: visibilityLooks.user.label,
                workspace: visibilityLooks.workspace.label,
              }}
              onChange={visibility.change}
            />
          </Row>
        </Group>

        <Group
          title="Instructions"
          description="Added to every run of this agent."
        >
          {/* The card is the field: its text on the title's line. */}
          <Textarea
            aria-label="Instructions"
            value={instructions.value}
            onChange={(event) => instructions.change(event.target.value)}
            onBlur={instructions.flush}
            className="min-h-40 resize-y rounded-none border-0 bg-transparent px-4 py-3 shadow-none dark:bg-transparent"
          />
        </Group>

        <Group title="Model">
          <Row title="Model" description="Used for this agent's runs.">
            <Choice
              label="Model"
              value={model.value}
              options={models}
              onChange={model.change}
            />
          </Row>
        </Group>

        <Checklist
          title="Skills"
          what="skills"
          items={skills}
          value={skillIds.value}
          onChange={skillIds.change}
        />
        <Checklist
          title="Connections"
          what="connections"
          items={connections}
          value={connectionIds.value}
          onChange={connectionIds.change}
        />
      </div>
    </Page>
  );
}

// Each field saves on its own into the agent (mock), saying "Agent saved".
function useAgentField<T>(initial: T, save: (value: T) => void) {
  return useAutosave(initial, save, "Agent saved");
}

// Which of a list the agent may use: a count under the heading, then one
// checkbox row each (the whole row toggles it), "All" first (checked only
// when all are).
function Checklist({
  title,
  what,
  items,
  value,
  onChange,
}: {
  title: string;
  /** Plural, for the count: "skills". */
  what: string;
  items: { id: string; title: string; description: string }[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const all = items.every(({ id }) => value.includes(id));
  return (
    <Group
      title={title}
      description={`Can use ${value.length} of ${items.length} ${what}.`}
    >
      <Row
        title={`All ${what}`}
        // biome-ignore lint/a11y/noLabelWithoutControl: the row is the label; its checkbox (media) is inside it.
        render={<label />}
        media={
          <Checkbox
            checked={all}
            onCheckedChange={() =>
              onChange(all ? [] : items.map(({ id }) => id))
            }
          />
        }
      />
      {items.map((item) => (
        <Row
          key={item.id}
          title={item.title}
          description={item.description}
          // biome-ignore lint/a11y/noLabelWithoutControl: the row is the label; its checkbox (media) is inside it.
          render={<label />}
          media={
            <Checkbox
              checked={value.includes(item.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...value, item.id]
                    : value.filter((id) => id !== item.id),
                )
              }
            />
          }
        />
      ))}
    </Group>
  );
}
