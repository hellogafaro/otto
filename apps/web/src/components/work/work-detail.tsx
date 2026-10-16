import type { WorkResource } from "@otto/contracts";
import { RiAddLine, RiCloseLine, RiLink } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import * as Match from "effect/Match";
import * as Schema from "effect/Schema";
import { Fragment, useState, type ReactNode } from "react";

import { useLocalStorage } from "../../hooks/use-local-storage";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import ChatMarkdown from "../chat-markdown";
import { CONTENT_ROW_CLASS } from "../content-row";
import { DetailsAside } from "../details-aside";
import { SETTINGS_SECTION_TITLE_CLASS } from "../settings/settings-layout";
import { PickerList, handlePickerKey, type PickerItem } from "../picker-list";
import { RichTextEditor } from "../rich-text-editor";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { WorkspacePageContainer } from "../workspace-page-container";
import { entityIcon, matchItems, useEntities } from "./work-links";
import { WorkPage, useWorkData } from "./work-pages";
import { useDesktopTabTitle } from "../../desktop-tabs-store";

/**
 * Otto: A task, project or routine page, like a Linear issue: the main column keeps
 * what matters (an optional cover, then title and description 12px apart, then
 * each section 40px apart with no rules, like Settings) and every property sits in the shared
 * details sidebar, open by default and remembered per type, in collapsible
 * groups with no card around them. A page with `tabs` shows them under the cover; a tab
 * other than the first passes its `view`, which takes the place of the title, description
 * and sections.
 */
export function WorkDetailPage({
  type,
  back,
  actions,
  cover,
  tabs,
  view,
  title,
  onTitleSave,
  onTitleClear,
  description,
  onDescriptionSave,
  sections,
  aside,
}: {
  readonly type: "task" | "project" | "routine";
  /** The way back to the list the page belongs to. */
  readonly back?: { readonly label: string; readonly onBack: () => void };
  readonly actions?: ReactNode;
  /** Shown above the title, full content width. */
  readonly cover?: ReactNode;
  /** `DetailsTabs` between the cover and the title. */
  readonly tabs?: ReactNode;
  /** The open tab's content, when it is not the overview. */
  readonly view?: ReactNode;
  readonly title: string;
  /** Omitted for a page whose content changes another way, like a routine through its bot. */
  readonly onTitleSave?: (title: string) => void;
  /** Called when the title is cleared; without it a cleared title keeps the saved one. */
  readonly onTitleClear?: () => void;
  readonly description: string;
  readonly onDescriptionSave?: (description: string) => void;
  readonly sections: readonly { readonly key: string; readonly content: ReactNode }[];
  readonly aside: ReactNode;
}) {
  const { t } = useI18n();
  const links = useEntities();
  useDesktopTabTitle(title);

  const [detailsOpen, setDetailsOpen] = useLocalStorage(
    `otto:${type}-details-open`,
    true,
    Schema.Boolean,
  );

  const labels = Match.value(type).pipe(
    Match.when("task", () => ({
      sidebar: t("Task details"),
      open: t("Open task details"),
      collapse: t("Collapse task details"),
      close: t("Close task details"),
      sheetTitle: t("Task details"),
    })),
    Match.when("project", () => ({
      sidebar: t("Project details"),
      open: t("Open project details"),
      collapse: t("Collapse project details"),
      close: t("Close project details"),
      sheetTitle: t("Project details"),
    })),
    Match.orElse(() => ({
      sidebar: t("Routine details"),
      open: t("Open routine details"),
      collapse: t("Collapse routine details"),
      close: t("Close routine details"),
      sheetTitle: t("Routine details"),
    })),
  );

  return (
    <>
      <WorkPage {...(back ? { back } : {})} actions={actions} detailsPanelOpen={detailsOpen}>
        <WorkspacePageContainer className="gap-10 pt-3 pb-16 sm:pt-4">
          <div className="flex flex-col gap-3">
            {cover ? (
              <div
                className={cn(
                  "mx-4 overflow-hidden rounded-lg border border-border",
                  tabs ? "mb-2" : "mb-4",
                )}
              >
                {cover}
              </div>
            ) : null}
            {tabs ? <div className="mb-5 px-4">{tabs}</div> : null}
            {view ?? (
              <>
                {onTitleSave ? (
                  <WorkTitleField
                    key={title}
                    value={title}
                    onSave={onTitleSave}
                    {...(onTitleClear ? { onClear: onTitleClear } : {})}
                  />
                ) : (
                  <h1 className={WORK_TITLE_CLASS}>{title}</h1>
                )}
                {onDescriptionSave ? (
                  <RichTextEditor
                    key={description}
                    className="px-4"
                    value={description}
                    placeholder={t("Add a description…")}
                    ariaLabel={t("Description")}
                    links={links}
                    onBlur={(markdown) => {
                      if (markdown.trim() !== description) onDescriptionSave(markdown.trim());
                    }}
                  />
                ) : (
                  <ChatMarkdown className="px-4" cwd={undefined} text={description} />
                )}
              </>
            )}
          </div>
          {view
            ? null
            : sections.map((section) => <Fragment key={section.key}>{section.content}</Fragment>)}
        </WorkspacePageContainer>
      </WorkPage>
      <DetailsAside
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        testId={`${type}-details-panel`}
        labels={labels}
      >
        <div className="flex flex-col gap-4 px-5 pt-1 pb-6">{aside}</div>
      </DetailsAside>
    </>
  );
}

const WORK_TITLE_CLASS =
  "w-full px-4 text-22px leading-title font-medium tracking-title-lg text-foreground";

/**
 * The page's 22px title, edited in place; an empty title keeps the saved one, after
 * `onClear` when given. Key it by the value.
 */
export function WorkTitleField({
  value,
  onSave,
  onClear,
}: {
  readonly value: string;
  readonly onSave: (title: string) => void;
  readonly onClear?: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const title = draft.trim();

    if (title.length === 0) {
      setDraft(value);
      onClear?.();

      return;
    }

    if (title !== value) onSave(title);
  };

  return (
    <input
      aria-label={t("Title")}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();

        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={cn("bg-transparent outline-none", WORK_TITLE_CLASS)}
    />
  );
}

type ResourceOption = PickerItem & { readonly resource: WorkResource };

const isWebLink = (text: string) => /^https?:\/\/\S+$/i.test(text);

const stripScheme = (url: string) => url.replace(/^https?:\/\//i, "");

const resourceKey = (resource: WorkResource) =>
  resource.type === "link" ? `link:${resource.url}` : `${resource.type}:${resource.id}`;

const RESOURCE_ROW_CLASS =
  "flex h-full min-w-0 flex-1 items-center gap-2 rounded-md ps-4 pe-8 text-13px outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

/**
 * Anything worth keeping next to the work, in 28px rows like the roster's:
 * web links, and other tasks and projects shown by their current title. The
 * list ends in a quiet "Add link, task or project…" row, also the whole empty
 * state, whose popover takes a pasted link or searches tasks and projects.
 */
export function WorkResourcesSection({
  self,
  resources,
  onChange,
}: {
  /** The page's own task or project, which never lists itself. */
  readonly self: { readonly type: "task" | "project"; readonly id: string };
  readonly resources: readonly WorkResource[];
  readonly onChange: (resources: WorkResource[]) => void;
}) {
  const { t } = useI18n();
  const { tasks, projects } = useWorkData();
  const entities = useEntities();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const taken = new Set([...resources.map(resourceKey), `${self.type}:${self.id}`]);
  const text = query.trim();

  const options: ResourceOption[] = [
    ...(isWebLink(text) && !taken.has(`link:${text}`)
      ? [
          {
            key: `link:${text}`,
            label: stripScheme(text),
            icon: <RiLink />,
            hint: t("Add link"),
            resource: { type: "link" as const, title: stripScheme(text), url: text },
          },
        ]
      : []),
    ...matchItems(
      entities.filter((item) => item.type === "task" || item.type === "project"),
      text,
      20,
    )
      .filter((item) => !taken.has(item.key))
      .slice(0, 8)
      .map((item) => ({
        key: item.key,
        label: item.label,
        icon: item.icon,
        hint: item.hint,
        resource: {
          type: item.type === "task" ? ("task" as const) : ("project" as const),
          id: item.id,
        },
      })),
  ];

  const close = () => {
    setAdding(false);
    setQuery("");
    setActive(0);
  };

  const pick = (option: ResourceOption) => {
    onChange([...resources, option.resource]);
    close();
  };

  return (
    <section className="flex flex-col gap-0.5">
      <WorkSectionHeader label={t("Resources")} />
      {resources.map((resource) => {
        const key = resourceKey(resource);

        const label = Match.value(resource).pipe(
          Match.when({ type: "link" }, (link) => link.title),
          Match.when(
            { type: "task" },
            (item) => tasks.find((task) => task.id === item.id)?.title ?? t("Task"),
          ),
          Match.orElse(
            (item) => projects.find((project) => project.id === item.id)?.title ?? t("Project"),
          ),
        );

        return (
          <div
            key={key}
            className="group/resource relative flex h-8 items-center rounded-md hover:bg-foreground/[0.035]"
          >
            {Match.value(resource).pipe(
              Match.when({ type: "link" }, (link) => (
                <a href={link.url} target="_blank" rel="noreferrer" className={RESOURCE_ROW_CLASS}>
                  <RiLink aria-hidden />
                  <span className="truncate text-foreground">{label}</span>
                  {label !== stripScheme(link.url) ? (
                    <span className="truncate text-muted-foreground">{stripScheme(link.url)}</span>
                  ) : null}
                </a>
              )),
              Match.when({ type: "task" }, (item) => (
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: item.id }}
                  className={RESOURCE_ROW_CLASS}
                >
                  {entityIcon("task")}
                  <span className="truncate text-foreground">{label}</span>
                </Link>
              )),
              Match.orElse((item) => (
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: item.id }}
                  className={RESOURCE_ROW_CLASS}
                >
                  {entityIcon("project")}
                  <span className="truncate text-foreground">{label}</span>
                </Link>
              )),
            )}
            <span className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-focus-within/resource:opacity-100 group-hover/resource:opacity-100">
              <Button
                size="icon-row"
                variant="ghost-muted"
                aria-label={t("Remove")}
                onClick={() => onChange(resources.filter((entry) => resourceKey(entry) !== key))}
              >
                <RiCloseLine className="size-3.5" />
              </Button>
            </span>
          </div>
        );
      })}
      <Popover open={adding} onOpenChange={(open) => (open ? setAdding(true) : close())}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                CONTENT_ROW_CLASS,
                "text-muted-foreground hover:text-foreground data-[popup-open]:text-foreground",
              )}
            />
          }
        >
          <RiAddLine aria-hidden className="size-3.5 shrink-0" />
          {t("Add link, task or project…")}
        </PopoverTrigger>
        <PopoverPopup side="bottom" align="start" viewportPadding="none" className="w-80">
          <input
            autoFocus
            aria-label={t("Add resource")}
            placeholder={t("Paste a link or search tasks and projects")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (handlePickerKey(event.key, options, active, setActive, pick)) {
                event.preventDefault();
              }
            }}
            className="h-9 w-full border-b border-border bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="max-h-64 overflow-y-auto p-1">
            <PickerList
              items={options}
              active={active}
              emptyLabel={t("No results")}
              onActiveChange={setActive}
              onPick={pick}
            />
          </div>
        </PopoverPopup>
      </Popover>
    </section>
  );
}

/** A main-column section heading in the Settings section style, 8px above its rows, with an optional 24px plus. */
export function WorkSectionHeader({
  label,
  aside,
  add,
}: {
  readonly label: string;
  /** Quiet 13px info on the right, such as a count. */
  readonly aside?: ReactNode;
  readonly add?: { readonly label: string; readonly onClick: () => void };
}) {
  return (
    <div className="mb-2 flex h-7 items-center gap-1 ps-4 pe-2.5">
      <h2 className={cn("min-w-0 flex-1", SETTINGS_SECTION_TITLE_CLASS)}>{label}</h2>
      {aside ? <span className="text-13px tabular-nums text-muted-foreground">{aside}</span> : null}
      {add ? (
        <Button size="icon-row" variant="ghost-muted" aria-label={add.label} onClick={add.onClick}>
          <RiAddLine className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
