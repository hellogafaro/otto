/**
 * The Library (`/{ws}/library`): documents and files in one gallery. Tabs All / Files / Documents (`?tab=`),
 * the open folder (`?folder=`, a muted breadcrumb under the tabs), folders first in every tab, then files, then
 * documents. The title row: Filter ("Created by": You, Agents), Search (the palette on Library) and "+" (Upload file, New document, New folder),
 * all landing in the open folder. A tile opens its folder or item; its menu renames, moves, copies the link or
 * deletes. An empty Library is the stock empty page, its button the same "+" menu.
 */

import * as React from 'react'
import { FilePlus, FolderPlus, Library, Upload, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@workspace/ui/components/breadcrumb'
import { Button } from '@workspace/ui/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { FilterBar, FilterMenu, NoResults, type FilterField } from '@workspace/ui/components/filters'
import { Gallery, GalleryItemSkeleton } from '@workspace/ui/components/gallery'
import { PageColumn } from '@workspace/ui/components/page'
import { toast } from '@workspace/ui/components/sonner'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { PageHeader } from '@/components/app-shell/page-header'
import { CommandPaletteButton } from '@/components/command-palette/command-palette-button'
import { CreateButton } from '@/components/ui/create-button'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { useLibrary } from '@/hooks/use-library'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { LIBRARY_TABS, type LibraryTab } from '../../../shared/section-search'
import { libraryErrorMessage, useLibraryItemDialogs } from './item-dialogs'
import { AGENTS_FILTER, getFolderPath, getVisibleItems, MAX_FILE_BYTES, MAX_FOLDER_DEPTH, readFileAsBase64 } from './library-items'
import { LibraryTile } from './library-tile'
import { useLibraryFilters } from './use-library-filters'

const TAB_LABELS: Record<LibraryTab, string> = { all: 'library.tabAll', files: 'library.tabFiles', documents: 'library.tabDocuments' }

/** The "+" menu: Upload file, New document, New folder (not in a folder that is already eight levels deep). */
function AddMenu({ trigger, canAddFolder, onUpload, onNewDocument, onNewFolder }: {
  trigger: React.ReactElement
  canAddFolder: boolean
  onUpload: () => void
  onNewDocument: () => void
  onNewFolder: () => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onUpload}><Upload />{t('library.uploadFile')}</DropdownMenuItem>
        <DropdownMenuItem onClick={onNewDocument}><FilePlus />{t('library.newDocument')}</DropdownMenuItem>
        <DropdownMenuItem disabled={!canAddFolder} onClick={onNewFolder}><FolderPlus />{t('library.newFolder')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type Creating = 'folder' | 'document'
type Pending = { key: string; title: string; parentId: string | null }

export function LibraryPage() {
  const { t } = useTranslation()
  useComposerContext({ key: 'page:library' })
  const { items, loaded, createLibraryItem, createLibraryFolder } = useLibrary()
  const { me } = useWorkspaceMembers()
  const { view, setSearch, openItem } = useLibraryFilters()
  const dialogs = useLibraryItemDialogs()
  const [creating, setCreating] = React.useState<Creating | null>(null)
  const [pending, setPending] = React.useState<Pending[]>([])
  const fileInput = React.useRef<HTMLInputElement>(null)

  const path = getFolderPath(items, view.folder)
  const visible = getVisibleItems(items, view)
  const uploading = pending.filter((upload) => upload.parentId === view.folder && view.tab !== 'documents')
  const canAddFolder = path.length < MAX_FOLDER_DEPTH

  // A folder that is gone (deleted, or a stale link): back to the Library's root.
  React.useEffect(() => {
    if (loaded && view.folder && path.length === 0) setSearch({ folder: undefined })
  }, [loaded, view.folder, path.length]) // eslint-disable-line react-hooks/exhaustive-deps -- when the folder goes missing

  const upload = async (files: File[]) => {
    const parentId = view.folder
    const queued = files.map((file) => ({ file, key: `${file.name}-${file.lastModified}-${Math.random()}` }))
    setPending((current) => [...current, ...queued.map(({ file, key }) => ({ key, title: file.name, parentId }))])
    for (const { file, key } of queued) {
      try {
        if (file.size > MAX_FILE_BYTES) {
          toast.error(t('library.tooLarge', { title: file.name }))
          continue
        }
        const data = await readFileAsBase64(file)
        const result = await createLibraryItem({ title: file.name, mime: file.type || 'application/octet-stream', content: { encoding: 'base64', data }, parentId })
        if (!result.ok) toast.error(result.code === 'too_large' ? t('library.tooLarge', { title: file.name }) : t('library.uploadFailed', { title: file.name }))
      } catch {
        toast.error(t('library.uploadFailed', { title: file.name }))
      } finally {
        setPending((current) => current.filter((entry) => entry.key !== key))
      }
    }
  }

  const submitCreate = async (name: string) => {
    if (!creating) return
    setCreating(null)
    if (creating === 'folder') {
      const result = await createLibraryFolder({ title: name, parentId: view.folder })
      if (!result.ok) toast.error(libraryErrorMessage(t, result.code))
      return
    }
    // The library refuses empty files: a new document starts as one line break.
    const result = await createLibraryItem({ title: `${name}.md`, mime: 'text/markdown', content: { encoding: 'utf8', data: '\n' }, parentId: view.folder })
    if (result.ok) openItem(result.value.id)
    else toast.error(libraryErrorMessage(t, result.code))
  }

  const addMenu = (trigger: React.ReactElement) => (
    <AddMenu
      trigger={trigger}
      canAddFolder={canAddFolder}
      onUpload={() => fileInput.current?.click()}
      onNewDocument={() => setCreating('document')}
      onNewFolder={() => setCreating('folder')}
    />
  )

  const fields: FilterField[] = [{
    key: 'createdBy',
    label: t('library.createdBy'),
    icon: <User />,
    options: [
      ...(me ? [{ value: me, label: t('library.you') }] : []),
      { value: AGENTS_FILTER, label: t('library.agents') },
    ],
  }]
  const values = { createdBy: view.createdBy ? [view.createdBy] : [] }
  // One creator at a time (the route holds one): the last one picked.
  const changeFilter = (_key: string, next: string[]) => setSearch({ createdBy: next[next.length - 1] })

  const shared = (
    <>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) void upload(files)
        }}
      />
      <RenameDialog
        open={creating !== null}
        onOpenChange={(open) => { if (!open) setCreating(null) }}
        title={creating === 'folder' ? t('library.newFolder') : t('library.newDocument')}
        defaultValue=""
        onSubmit={submitCreate}
        placeholder={t('library.titlePlaceholder')}
        submitLabel={t('common.create')}
      />
      {dialogs.dialogs}
    </>
  )

  // Nothing in the Library at all: the stock empty page, its button the "+" menu.
  if (loaded && items.length === 0 && pending.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader />
        <EntityListEmptyScreen icon={<Library />} title={t('sectionEmpty.libraryTitle')} description={t('sectionEmpty.libraryDescription')}>
          {addMenu(<DropdownMenuTrigger render={<Button />}>{t('sectionEmpty.addToLibrary')}</DropdownMenuTrigger>)}
        </EntityListEmptyScreen>
        {shared}
      </div>
    )
  }

  const empty = view.createdBy ? (
    <NoResults title={t('library.noResults')} description={t('library.noResultsDescription')}>
      <Button variant="outline" onClick={() => setSearch({ createdBy: undefined })}>{t('library.clearFilters')}</Button>
    </NoResults>
  ) : (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t(view.tab === 'documents' ? 'library.noDocuments' : 'library.noFiles')}</EmptyTitle>
        <EmptyDescription>
          {t(view.tab === 'documents' ? 'library.noDocumentsDescription' : view.tab === 'files' ? 'library.noFilesDescription' : 'library.emptyFolderDescription')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('library.title')}
        actions={<><FilterMenu fields={fields} values={values} onChange={changeFilter} label={t('library.filter')} /><CommandPaletteButton category="library" />{addMenu(<DropdownMenuTrigger render={<CreateButton label={t('library.add')} />} />)}</>}
      />
      <PageColumn className="min-h-full">
        <div data-content-start="" className="flex flex-1 flex-col gap-3">
          <Tabs value={view.tab} onValueChange={(tab) => setSearch({ tab: tab as LibraryTab })}>
            <TabsList className="px-1">
              {LIBRARY_TABS.map((tab) => <TabsTrigger key={tab} value={tab}>{t(TAB_LABELS[tab])}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          {path.length > 0 && (
            <Breadcrumb className="px-4">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<button type="button" />} onClick={() => setSearch({ folder: undefined })}>{t('library.title')}</BreadcrumbLink>
                </BreadcrumbItem>
                {path.map((folder, index) => (
                  <React.Fragment key={folder.id}>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      {index === path.length - 1
                        ? <BreadcrumbPage>{folder.title}</BreadcrumbPage>
                        : <BreadcrumbLink render={<button type="button" />} onClick={() => setSearch({ folder: folder.id })}>{folder.title}</BreadcrumbLink>}
                    </BreadcrumbItem>
                  </React.Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          )}
          <FilterBar
            fields={fields}
            values={values}
            onChange={changeFilter}
            isLabel={t('library.is')}
            isAnyOfLabel={t('library.isAnyOf')}
            removeLabel={(field) => `${t('common.remove')} ${field}`}
          />
          {!loaded ? (
            <Gallery columns={4}>
              {Array.from({ length: 8 }, (_, index) => <GalleryItemSkeleton key={index} />)}
            </Gallery>
          ) : visible.length === 0 && uploading.length === 0 ? (
            empty
          ) : (
            <Gallery columns={4}>
              {visible.map((item) => (
                <LibraryTile
                  key={item.id}
                  item={item}
                  onOpen={() => (item.type === 'folder' ? setSearch({ folder: item.id }) : openItem(item.id))}
                  actions={{
                    onRename: () => dialogs.rename(item),
                    onMove: () => dialogs.move(item),
                    onCopyLink: () => dialogs.copyLink(item),
                    onDelete: () => dialogs.remove(item),
                  }}
                />
              ))}
              {uploading.map((upload) => <LibraryTile key={upload.key} item={{ type: 'file', title: upload.title }} disabled />)}
            </Gallery>
          )}
        </div>
      </PageColumn>
      {shared}
    </div>
  )
}
