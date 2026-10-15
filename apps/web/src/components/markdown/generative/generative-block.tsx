import type { GenerativeBlockSpec } from "./generative-schemas";
import { GenerativeChart } from "./generative-chart";
import { GenerativeChoices } from "./generative-choices";
import { GenerativeFlow } from "./generative-flow";
import { GenerativeStats } from "./generative-stats";
import { GenerativeTasks } from "./generative-tasks";
import { GenerativeTimeline } from "./generative-timeline";

export function GenerativeBlock({ block }: { readonly block: GenerativeBlockSpec }) {
  switch (block.kind) {
    case "chart":
      return <GenerativeChart spec={block.spec} />;
    case "stats":
      return <GenerativeStats spec={block.spec} />;
    case "tasks":
      return <GenerativeTasks spec={block.spec} />;
    case "flow":
      return <GenerativeFlow spec={block.spec} />;
    case "choices":
      return <GenerativeChoices spec={block.spec} />;
    case "timeline":
      return <GenerativeTimeline spec={block.spec} />;
  }
}
