import { useLingui } from "@lingui/react/macro";
import { ArrowUpRight } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import type { Components } from "react-markdown";
import { lazy, Suspense, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../../shared/hooks/useFocusTrap";
import { openCheckout } from "../../license/api";
import { dismissAnnouncement, type Announcement } from "../api";
import { newsKeys } from "../queries";

const ReleaseNotesMarkdown = lazy(
  () => import("../../updates/components/ReleaseNotesMarkdown"),
);

// Images load without a click, so only hosts we control may serve them; any
// other host would learn the user's IP address.
const IMAGE_HOSTS = ["tryglimpse.cc", "github.com"];

const isAllowedImage = (value: string): boolean => {
  try {
    const { protocol, hostname } = new URL(value);
    return protocol === "https:" && IMAGE_HOSTS.includes(hostname);
  } catch {
    return false;
  }
};

const dialogMarkdown: Components = {
  h1: ({ children }) => (
    <h2
      id="announcement-title"
      className="mb-2 ui-text-title font-semibold text-content-primary text-balance"
    >
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-5 mb-2 ui-text-body-strong text-content-primary first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2.5 ui-text-section-label ui-color-muted first:mt-0">
      {children}
    </h3>
  ),
  // An image on its own line renders bare, so a leading one can sit flush with the top.
  p: ({ node, children }) =>
    node?.children.length === 1 &&
    node.children[0].type === "element" &&
    node.children[0].tagName === "img" ? (
      <>{children}</>
    ) : (
      <p className="mb-3 ui-text-body leading-relaxed text-content-secondary text-pretty last:mb-0">
        {children}
      </p>
    ),
  img: ({ src, alt }) =>
    typeof src === "string" && isAllowedImage(src) ? (
      <img
        src={src}
        alt={alt ?? ""}
        className="-mx-6 mb-5 block aspect-[2/1] w-[calc(100%+3rem)] max-w-none bg-surface-elevated object-cover first:-mt-6"
      />
    ) : null,
  ul: ({ children }) => (
    <ul className="mb-3 space-y-2 last:mb-0">{children}</ul>
  ),
  li: ({ children }) => (
    <li className="flex items-start gap-2.5 ui-text-body-sm leading-relaxed text-content-secondary text-pretty">
      <span
        className="mt-[0.5lh] size-1 shrink-0 -translate-y-1/2 rounded-full bg-current"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  ),
};

type AnnouncementScreenProps = {
  announcement: Announcement;
};

// Release notes after an update, or a message from the site, as a dialog over
// the main window. Waits for the markdown chunk so the dialog mounts whole.
const AnnouncementScreen = ({ announcement }: AnnouncementScreenProps) =>
  createPortal(
    <Suspense fallback={null}>
      <AnnouncementDialog announcement={announcement} />
    </Suspense>,
    document.body,
  );

const AnnouncementDialog = ({ announcement }: AnnouncementScreenProps) => {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);

  const dismiss = () => {
    queryClient.setQueryData(newsKeys.announcement(), null);
    void dismissAnnouncement(announcement).catch(() => {});
  };
  // Focuses the panel before the trap would pick a button or link, so no focus ring shows on open.
  useEffect(() => dialogRef.current?.focus({ preventScroll: true }), []);
  useFocusTrap(dialogRef, true, dismiss);

  const button = announcement.kind === "message" ? announcement : null;
  const act = () => {
    dismiss();
    if (button?.checkout) {
      void openCheckout({
        tier: button.checkout,
        source: "announcement",
        code: button.code ?? undefined,
      }).catch((err) => console.error("Failed to open checkout:", err));
    } else if (button?.url) {
      void openUrl(button.url).catch((err) =>
        console.error("Failed to open link:", err),
      );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6 backdrop-blur-xs"
      // A press that starts inside the panel (like a scrollbar drag) and ends here doesn't close it.
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) {
          dismiss();
        }
      }}
    >
      <motion.div
        ref={dialogRef}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="flex max-h-[min(80vh,640px)] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl border border-border-primary bg-surface-tertiary ui-shadow-modal-deep outline-hidden"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-title"
      >
        {announcement.kind === "releaseNotes" && (
          <h2
            id="announcement-title"
            className="shrink-0 px-6 pt-6 pb-1 ui-text-title font-semibold text-content-primary text-balance"
          >
            {t({
              id: "announcement.release_notes.title",
              message: `What's new in Glimpse ${{ version: announcement.version }}`,
            })}
          </h2>
        )}
        <div
          className={`min-h-0 flex-1 overflow-y-auto settings-scroll px-6 pb-2 ${announcement.kind === "releaseNotes" ? "pt-4 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-24px),transparent)]" : "pt-6"}`}
        >
          <ReleaseNotesMarkdown
            body={announcement.markdown}
            components={dialogMarkdown}
          />
        </div>
        <div
          className={`grid shrink-0 gap-2 px-6 pt-4 pb-6 ${button?.button ? "grid-cols-2" : "grid-cols-1"}`}
        >
          {button?.button && (
            <button
              type="button"
              onClick={dismiss}
              className="h-10 rounded-lg bg-[var(--surface-interactive)] ui-text-body-sm ui-color-primary transition-colors hover:bg-[var(--surface-interactive-strong)]"
            >
              {t({ id: "announcement.continue", message: "Continue" })}
            </button>
          )}
          <button
            type="button"
            onClick={button?.button ? act : dismiss}
            className="ui-button-primary flex h-10 items-center justify-center gap-1.5 rounded-lg ui-text-body-sm"
          >
            {button?.button ??
              t({ id: "announcement.continue", message: "Continue" })}
            {button?.button && <ArrowUpRight size={13} aria-hidden="true" />}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default AnnouncementScreen;
