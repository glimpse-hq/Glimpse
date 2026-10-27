import type { ComponentProps } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";

type CopyButtonProps = Omit<
  ComponentProps<"button">,
  "onClick" | "children"
> & {
  getText: () => string;
  iconSize: number;
  resetMs?: number;
  copiedClassName?: string;
};

// Owns the copied flag so the confirmation re-renders only this button, not
// the long transcript around it.
export default function CopyButton({
  getText,
  iconSize,
  resetMs,
  className,
  copiedClassName,
  ...props
}: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard(resetMs);
  return (
    <button
      type="button"
      {...props}
      onClick={() => void copy(getText())}
      className={copied ? (copiedClassName ?? className) : className}
    >
      {copied ? <Check size={iconSize} /> : <Copy size={iconSize} />}
    </button>
  );
}
