// Hover label beside a collapsed sidebar item; the parent must be `group relative`.
const SidebarTip = ({ label, show }: { label: string; show: boolean }) => {
  if (!show) return null;
  return (
    <span
      aria-hidden="true"
      className="sidebar-tip pointer-events-none whitespace-nowrap rounded-md px-2.5 ui-text-meta font-medium text-content-primary"
    >
      {label}
    </span>
  );
};

export default SidebarTip;
