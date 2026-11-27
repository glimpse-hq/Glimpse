import { useLingui } from "@lingui/react/macro";
import NameDialog from "../../../shared/ui/NameDialog";

export type FolderDialogState =
  { mode: "new"; itemId?: string } | { mode: "rename"; folder: string };

const LibraryFolderDialog = ({
  state,
  onCancel,
  onSubmit,
}: {
  state: FolderDialogState | null;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) => {
  const { t } = useLingui();
  const rename = state?.mode === "rename";

  return (
    <NameDialog
      open={state !== null}
      initialName={state?.mode === "rename" ? state.folder : ""}
      title={
        rename
          ? t({ id: "library.folder.rename_title", message: "Rename Folder" })
          : t({ id: "library.folder.new_title", message: "New Folder" })
      }
      submitLabel={
        rename
          ? t({ id: "library.folder.rename_save", message: "Rename" })
          : t({ id: "library.folder.create", message: "Create" })
      }
      cancelLabel={t({ id: "library.folder.cancel", message: "Cancel" })}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
};

export default LibraryFolderDialog;
