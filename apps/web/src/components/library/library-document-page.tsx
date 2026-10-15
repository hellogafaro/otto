import {
  splitFrontMatter,
  type EnvironmentId,
  type LibraryFile,
  type LibraryFileId,
} from "@otto/contracts";
import { RiDownloadLine, RiFileTextLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocalStorage } from "../../hooks/use-local-storage";
import { useEnvironmentConnectionState } from "../../state/environments";
import { useI18n } from "../../i18n";
import { libraryEnvironment } from "../../state/library";
import { useAtomCommand } from "../../state/use-atom-command";
import { DetailsAside } from "../details-aside";
import { RichTextEditor } from "../rich-text-editor";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { WorkspacePageContainer } from "../workspace-page-container";
import { WorkTitleField } from "../work/work-detail";
import { WorkEmpty, WorkPage } from "../work/work-pages";
import { useEntities } from "../work/work-links";
import { LibraryItemMenu } from "./library-actions";
import { LibraryFileDetails } from "./library-details";
import { joinFrontMatter } from "./library.logic";
import {
  useLibraryData,
  useLibraryDownload,
  useLibraryFailure,
  type LibraryData,
} from "./use-library";

const SAVE_DELAY_MS = 800;

/**
 * Otto: A .md file opened as a document page: the title, then the contents in
 * the shared rich text editor, saved as markdown shortly after typing stops,
 * with the file's Details in the sidebar like a task. A save made over someone
 * else's newer change is rejected and the page offers to reload.
 */
export function LibraryDocumentPage({ fileId }: { readonly fileId: LibraryFileId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const data = useLibraryData();
  const file = data.files.find((candidate) => candidate.id === fileId);

  const back = {
    label: t("Library"),
    onBack: () =>
      void navigate({ to: "/library", search: file?.folderId ? { folder: file.folderId } : {} }),
  };

  if (!data.loaded) return <WorkPage back={back}>{null}</WorkPage>;

  if (!file || file.type !== "document" || data.environmentId === null) {
    return (
      <WorkPage back={back}>
        <WorkEmpty
          icon={<RiFileTextLine />}
          title={t("Document not found")}
          description={t("It may have been deleted, or it isn't shared with you.")}
        />
      </WorkPage>
    );
  }

  return (
    <DocumentEditor
      key={file.id}
      environmentId={data.environmentId}
      data={data}
      file={file}
      back={back}
    />
  );
}

type Loaded = { readonly content: string; readonly updatedAt: string };

function DocumentEditor({
  environmentId,
  data,
  file,
  back,
}: {
  readonly environmentId: EnvironmentId;
  readonly data: LibraryData;
  readonly file: LibraryFile;
  readonly back: { readonly label: string; readonly onBack: () => void };
}) {
  const { t } = useI18n();
  const links = useEntities();
  const download = useLibraryDownload();
  const fail = useLibraryFailure();
  const readDocument = useAtomCommand(libraryEnvironment.readDocument, { reportFailure: false });
  const saveDocument = useAtomCommand(libraryEnvironment.saveDocument, { reportFailure: false });
  const updateFile = useAtomCommand(libraryEnvironment.updateFile);
  const [loaded, setLoaded] = useState<Loaded | "failed" | null>(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const base = useRef<string | null>(null);
  const baseContent = useRef("");
  const pending = useRef<string | null>(null);

  const parts = useRef<{ frontMatter: string | null; body: string }>({
    frontMatter: null,
    body: "",
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const editable = data.canEdit(file);

  const [detailsOpen, setDetailsOpen] = useLocalStorage(
    "otto:document-details-open",
    true,
    Schema.Boolean,
  );

  const load = useCallback(async () => {
    const result = await readDocument({ environmentId, input: { fileId: file.id } });

    if (!AsyncResult.isSuccess(result)) {
      setLoaded("failed");

      return;
    }

    base.current = result.value.updatedAt;
    baseContent.current = result.value.content;
    pending.current = null;
    parts.current = splitFrontMatter(result.value.content);
    setStale(false);
    setLoaded(result.value);
  }, [environmentId, file.id, readDocument]);

  /**
   * Renames, moves and visibility changes also move updatedAt. Only a change to the text makes
   * this copy stale, so on a newer updatedAt the saved text is compared with the one edited.
   */
  const reconcile = useCallback(async () => {
    const result = await readDocument({ environmentId, input: { fileId: file.id } });

    if (!AsyncResult.isSuccess(result)) return false;

    if (result.value.content !== baseContent.current) {
      setStale(true);

      return false;
    }

    base.current = result.value.updatedAt;

    return true;
  }, [environmentId, file.id, readDocument]);

  const connected = useEnvironmentConnectionState(environmentId).data?.phase === "connected";

  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  useEffect(() => {
    if (base.current === null || inFlight.current || file.updatedAt <= base.current) return;

    void reconcile();
  }, [file.updatedAt, reconcile]);

  const flush = useCallback(
    async (retry = true): Promise<void> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;

      if (inFlight.current || pending.current === null || base.current === null) return;
      const content = pending.current;
      pending.current = null;
      inFlight.current = true;
      setSaving(true);

      const result = await saveDocument({
        environmentId,
        input: { fileId: file.id, content, expectedUpdatedAt: base.current },
      });

      inFlight.current = false;
      setSaving(false);

      if (AsyncResult.isSuccess(result)) {
        base.current = result.value.updatedAt;
        baseContent.current = content;

        if (pending.current !== null) void flush();

        return;
      }

      pending.current ??= content;

      if (retry && (await reconcile())) {
        void flush(false);

        return;
      }

      fail(result, t("Could not save the document"));
    },
    [environmentId, fail, file.id, reconcile, saveDocument, t],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);

      void flush();
    },
    [flush],
  );

  const shown = loaded && loaded !== "failed" ? splitFrontMatter(loaded.content) : null;

  const onChange = (next: Partial<typeof parts.current>) => {
    parts.current = { ...parts.current, ...next };
    pending.current = joinFrontMatter(parts.current.frontMatter, parts.current.body);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  const actions = (
    <>
      {saving ? <span className="text-xs text-muted-foreground">{t("Saving…")}</span> : null}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("Download")}
        onClick={() => void download(environmentId, file.id)}
      >
        <RiDownloadLine />
      </Button>
      <LibraryItemMenu
        environmentId={environmentId}
        data={data}
        target={{ kind: "file", file }}
        onDeleted={back.onBack}
      />
    </>
  );

  return (
    <>
      <WorkPage back={back} actions={actions} detailsPanelOpen={detailsOpen}>
        <WorkspacePageContainer width="narrow" className="gap-6 pt-3 pb-16 sm:pt-4">
          {stale ? (
            <div
              role="status"
              className="mx-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary px-3 py-2 text-13px text-foreground"
            >
              <span>
                {t("This document changed since you opened it. Reload to see the latest version.")}
              </span>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {t("Reload")}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            {editable ? (
              <WorkTitleField
                key={file.title}
                value={file.title}
                onSave={(title) =>
                  void updateFile({ environmentId, input: { fileId: file.id, title } })
                }
              />
            ) : (
              <h1 className="px-4 text-22px leading-title font-medium tracking-title-lg text-foreground">
                {file.title}
              </h1>
            )}
            {loaded === "failed" ? (
              <p className="px-4 text-13px text-muted-foreground">
                {t("Could not open the document.")}
              </p>
            ) : loaded ? (
              <>
                {shown?.frontMatter == null ? null : (
                  <div className="px-4">
                    <Textarea
                      key={loaded.updatedAt}
                      aria-label={t("Front matter")}
                      defaultValue={shown.frontMatter}
                      readOnly={!editable}
                      onChange={(event) => onChange({ frontMatter: event.currentTarget.value })}
                      onBlur={() => void flush()}
                    />
                  </div>
                )}
                <RichTextEditor
                  key={loaded.updatedAt}
                  className="px-4"
                  value={shown?.body ?? loaded.content}
                  placeholder={editable ? t("Start writing…") : t("This document is empty.")}
                  ariaLabel={t("Document")}
                  links={links}
                  editable={editable}
                  onChange={(body) => onChange({ body })}
                  onBlur={() => void flush()}
                />
              </>
            ) : null}
          </div>
        </WorkspacePageContainer>
      </WorkPage>
      <DetailsAside
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        testId="document-details-panel"
        labels={{
          sidebar: t("Document details"),
          open: t("Open document details"),
          collapse: t("Collapse document details"),
          close: t("Close document details"),
          sheetTitle: t("Document details"),
        }}
      >
        <div className="flex flex-col gap-4 px-5 pt-1 pb-6">
          <LibraryFileDetails environmentId={environmentId} data={data} file={file} />
        </div>
      </DetailsAside>
    </>
  );
}
