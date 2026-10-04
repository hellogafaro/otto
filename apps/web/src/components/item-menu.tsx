import {
  RiArchiveLine,
  RiArrowRightUpLine,
  RiChat1Line,
  RiDeleteBinLine,
  RiDownloadLine,
  RiEditLine,
  RiLinkM,
} from "@remixicon/react";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@workspace/ui/components/dropdown-menu";
import { toast } from "@workspace/ui/components/sonner";
import { useConfirm } from "@/components/confirm";
import { request } from "@/mock/api";

// One menu for an item (a task, document, project, file or folder), the same
// in its More menu and on right-click (a context menu takes these items as
// they are). Short, in one order: Open, Ask about it (the page's floating
// chat), Download, Rename, Copy link; then Archive and Delete, apart, Delete
// always red and always asked first ("Delete file?", the stock alert dialog,
// which waits for it with a spinner). Copy link, Archive and Delete say they
// are done with a toast. Keys on the quick ones, shown and
// live while the menu is open: R, C, A, ⌫. Only the actions passed show.
export function ItemMenuItems({
  type,
  name,
  onOpen,
  onAsk,
  onDownload,
  onRename,
  link,
  onArchive,
  onDelete,
}: {
  /** What it is, for the Delete question: "file" asks "Delete file?". */
  type: string;
  /** What it is called, for the toasts. */
  name: string;
  onOpen?: () => void;
  onAsk?: () => void;
  onDownload?: () => void;
  onRename?: () => void;
  /** Its path, e.g. "/tasks/t1"; Copy link copies the full URL. */
  link?: string;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const confirm = useConfirm();
  return (
    <>
      <DropdownMenuGroup>
        {onOpen && (
          <DropdownMenuItem onClick={onOpen}>
            <RiArrowRightUpLine />
            Open
          </DropdownMenuItem>
        )}
        {onAsk && (
          <DropdownMenuItem onClick={onAsk}>
            <RiChat1Line />
            Ask about it
          </DropdownMenuItem>
        )}
        {onDownload && (
          <DropdownMenuItem onClick={onDownload}>
            <RiDownloadLine />
            Download
          </DropdownMenuItem>
        )}
        {onRename && (
          <DropdownMenuItem shortcut="R" onClick={onRename}>
            <RiEditLine />
            Rename
          </DropdownMenuItem>
        )}
        {link && (
          <DropdownMenuItem
            shortcut="C"
            onClick={() => {
              navigator.clipboard.writeText(`${location.origin}${link}`);
              toast.success("Link copied");
            }}
          >
            <RiLinkM />
            Copy link
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      {(onArchive || onDelete) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {onArchive && (
              <DropdownMenuItem
                shortcut="A"
                onClick={() => {
                  onArchive();
                  toast.success(`“${name}” archived`);
                }}
              >
                <RiArchiveLine />
                Archive
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                variant="destructive"
                shortcut="⌫"
                onClick={async () => {
                  // Delete always asks first, then says it is done.
                  const yes = await confirm({
                    title: `Delete ${type}?`,
                    description: "This can't be undone.",
                    action: "Delete",
                    destructive: true,
                    run: async () => {
                      await request();
                      onDelete();
                    },
                  });
                  if (yes) toast.success(`“${name}” deleted`);
                }}
              >
                <RiDeleteBinLine />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </>
      )}
    </>
  );
}
