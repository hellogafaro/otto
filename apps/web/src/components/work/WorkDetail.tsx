import type { WorkResource } from "@otto/contracts";
import { RiAddLine, RiCloseLine, RiLink } from "@remixicon/react";
import * as Schema from "effect/Schema";
import { Fragment, useState, type ReactNode } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useI18n } from "../../i18n";
import { DetailsAside } from "../DetailsAside";
import { RichTextEditor } from "../RichTextEditor";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkPage } from "./WorkPages";

/**
 * Otto: A task or project page, like a Linear issue: the main column keeps
 * what matters (title, rich description, then each section split by a 1px
 * rule, 24px apart) and every property sits in the shared details sidebar,
 * open by default and remembered per kind.
 */
export function WorkDetailPage({
  kind,
  back,
  actions,
  title,
  onTitleSave,
  description,
  onDescriptionSave,
  sections,
  aside,
}: {
  readonly kind: "task" | "project";
  readonly back: { readonly label: string; readonly onBack: () => void };
  readonly actions?: ReactNode;
  readonly title: string;
  readonly onTitleSave: (title: string) => void;
  readonly description: string;
  readonly onDescriptionSave: (description: string) => void;
  readonly sections: readonly { readonly key: string; readonly content: ReactNode }[];
  readonly aside: ReactNode;
}) {
  const { t } = useI18n();

  const [detailsOpen, setDetailsOpen] = useLocalStorage(
    `otto:${kind}-details-open`,
    true,
    Schema.Boolean,
  );

  const labels =
    kind === "task"
      ? {
          sidebar: t("Task details"),
          open: t("Open task details"),
          collapse: t("Collapse task details"),
          close: t("Close task details"),
          sheetTitle: t("Task details"),
        }
      : {
          sidebar: t("Project details"),
          open: t("Open project details"),
          collapse: t("Collapse project details"),
          close: t("Close project details"),
          sheetTitle: t("Project details"),
        };

  return (
    <>
      <WorkPage back={back} actions={actions} detailsPanelOpen={detailsOpen}>
        <WorkspacePageContainer width="narrow" className="gap-6 pt-3 pb-16 sm:pt-4">
          <div className="flex flex-col gap-2">
            <WorkTitleField key={title} value={title} onSave={onTitleSave} />
            <RichTextEditor
              key={description}
              className="px-4"
              value={description}
              placeholder={t("Add a description…")}
              ariaLabel={t("Description")}
              onBlur={(markdown) => {
                if (markdown.trim() !== description) onDescriptionSave(markdown.trim());
              }}
            />
          </div>
          {sections.map((section) => (
            <Fragment key={section.key}>
              <div role="separator" className="mx-4 border-t border-border" />
              {section.content}
            </Fragment>
          ))}
        </WorkspacePageContainer>
      </WorkPage>
      <DetailsAside
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={t("Details")}
        testId={`${kind}-details-panel`}
        labels={labels}
      >
        <div className="flex flex-col gap-6 px-2 pb-4">{aside}</div>
      </DetailsAside>
    </>
  );
}

/** The page's 22px title, edited in place; an empty title keeps the saved one. Key it by the value. */
export function WorkTitleField({
  value,
  onSave,
}: {
  readonly value: string;
  readonly onSave: (title: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const title = draft.trim();

    if (title.length === 0) return setDraft(value);

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
      className="w-full bg-transparent px-4 text-22px leading-title font-medium tracking-title-lg text-foreground outline-none"
    />
  );
}

/** Links worth keeping next to the work, in 28px rows like the roster's. */
export function WorkResourcesSection({
  resources,
  onChange,
}: {
  readonly resources: readonly WorkResource[];
  readonly onChange: (resources: WorkResource[]) => void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");

  const add = () => {
    const trimmed = url.trim();

    if (!/^https?:\/\//i.test(trimmed)) return;
    onChange([...resources, { title: trimmed.replace(/^https?:\/\//i, ""), url: trimmed }]);
    setUrl("");
    setAdding(false);
  };

  return (
    <section className="flex flex-col gap-0.5">
      <WorkSectionHeader
        label={t("Resources")}
        add={{ label: t("Add link"), onClick: () => setAdding(true) }}
      />
      {resources.map((resource) => (
        <div
          key={resource.url}
          className="group/resource relative flex h-7 items-center rounded-md hover:bg-foreground/[0.035]"
        >
          <a
            href={resource.url}
            target="_blank"
            rel="noreferrer"
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md ps-4 pe-8 text-13px outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RiLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-foreground">{resource.title}</span>
            {resource.title !== resource.url.replace(/^https?:\/\//i, "") ? (
              <span className="truncate text-muted-foreground">
                {resource.url.replace(/^https?:\/\//i, "")}
              </span>
            ) : null}
          </a>
          <span className="absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 group-focus-within/resource:opacity-100 group-hover/resource:opacity-100">
            <Button
              size="icon-row"
              variant="ghost-muted"
              aria-label={t("Remove")}
              onClick={() => onChange(resources.filter((entry) => entry.url !== resource.url))}
            >
              <RiCloseLine className="size-3.5" />
            </Button>
          </span>
        </div>
      ))}
      {adding ? (
        <form
          className="flex items-center gap-1.5 ps-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            autoFocus
            size="sm"
            type="url"
            aria-label={t("Link")}
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAdding(false);
            }}
          />
          <Button size="sm" type="submit">
            {t("Add link")}
          </Button>
        </form>
      ) : resources.length === 0 ? (
        <p className="ps-4 text-13px text-muted-foreground">{t("No links yet.")}</p>
      ) : null}
    </section>
  );
}

export function PropertyGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col items-start gap-0.5">
      <h2 className="flex h-7 items-center ps-2.5 text-xs font-medium text-muted-foreground">
        {label}
      </h2>
      {children}
    </section>
  );
}

/** A main-column section heading: 13px/500 muted on the content edge, with an optional 24px plus. */
export function WorkSectionHeader({
  label,
  add,
}: {
  readonly label: string;
  readonly add?: { readonly label: string; readonly onClick: () => void };
}) {
  return (
    <div className="flex h-7 items-center gap-1 ps-4 pe-2.5">
      <h2 className="min-w-0 flex-1 text-13px font-medium text-muted-foreground">{label}</h2>
      {add ? (
        <Button size="icon-row" variant="ghost-muted" aria-label={add.label} onClick={add.onClick}>
          <RiAddLine className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
