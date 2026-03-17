import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

const WindowControls = () => (
  <div className="flex items-center h-full ml-auto">
    <button
      type="button"
      onClick={() => appWindow.minimize()}
      aria-label="Minimize"
      className="inline-flex items-center justify-center w-[46px] h-8 hover:bg-white/10 transition-colors"
    >
      <svg width="10" height="1" viewBox="0 0 10 1">
        <rect width="10" height="1" fill="currentColor" />
      </svg>
    </button>
    <button
      type="button"
      onClick={() => appWindow.toggleMaximize()}
      aria-label="Maximize"
      className="inline-flex items-center justify-center w-[46px] h-8 hover:bg-white/10 transition-colors"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
      </svg>
    </button>
    <button
      type="button"
      onClick={() => appWindow.close()}
      aria-label="Close"
      className="inline-flex items-center justify-center w-[46px] h-8 hover:bg-[#c42b1c] transition-colors"
    >
      <svg width="10" height="10" viewBox="0 0 10 10">
        <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
  </div>
);

export default WindowControls;
