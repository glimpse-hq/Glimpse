import { Minus, Square, X } from "lucide-react";
import { useWindowControls } from "../hooks/useWindowControls";
import { getPlatformCapabilities } from "../../platform/service";

const WindowControls = () => {
  const shouldShow = getPlatformCapabilities().usesCustomWindowControls;

  if (!shouldShow) return null;

  return <WindowControlsButtons />;
};

const WindowControlsButtons = () => {
  const windowControls = useWindowControls();

  const buttonClass =
    "flex h-8 w-11 items-center justify-center text-content-muted transition-colors hover:bg-surface-elevated hover:text-content-primary";

  return (
    <div className="fixed right-0 top-0 z-50 flex h-8" data-window-controls>
      <button
        type="button"
        aria-label="Minimize"
        className={buttonClass}
        onClick={() => {
          void windowControls.minimize();
        }}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Maximize"
        className={buttonClass}
        onClick={() => {
          void windowControls.toggleMaximize();
        }}
      >
        <Square size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Close"
        className={`${buttonClass} hover:bg-red-500 hover:text-white`}
        onClick={() => {
          void windowControls.close();
        }}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
};

export default WindowControls;
