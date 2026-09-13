/**
 * Label that flies out beside a collapsed sidebar item on hover or focus.
 * Pure CSS: the parent must be `group relative`. Renders nothing when the
 * sidebar is expanded, since the label is already visible inline.
 */
const SidebarTip = ({ label, show }: { label: string; show: boolean }) => {
  if (!show) return null;
  return (
    <span
      role="tooltip"
      className="sidebar-tip pointer-events-none whitespace-nowrap rounded-md px-2.5 ui-text-meta font-medium text-content-primary"
    >
      {label}
    </span>
  );
};

export default SidebarTip;
