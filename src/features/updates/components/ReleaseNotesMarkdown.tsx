import { createContext, useContext, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkGithub from "remark-github";
import remarkBreaks from "remark-breaks";

const isSafeHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

const markdownPlugins: {
  remark: Options["remarkPlugins"];
} = {
  remark: [
    remarkGfm,
    [remarkGithub, { repository: "glimpse-hq/Glimpse", mentionStrong: false }],
    remarkBreaks,
  ],
};

const OrderedListContext = createContext(false);

function MarkdownListItem({ children }: { children?: ReactNode }) {
  const ordered = useContext(OrderedListContext);
  if (ordered) {
    return (
      <li className="pl-1 ui-text-body leading-relaxed ui-color-secondary">
        {children}
      </li>
    );
  }
  return (
    <li className="flex items-start gap-3 ui-text-body leading-relaxed ui-color-secondary">
      <span className="ui-color-warning-strong mt-1 ui-text-meta">●</span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h2 className="ui-text-title-strong ui-color-primary mt-5 mb-2 first:mt-0">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="ui-text-body-lg-strong ui-color-primary mt-5 mb-2 first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="ui-text-section-label ui-color-muted mt-5 mb-2 first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="ui-text-body leading-relaxed ui-color-secondary mb-3 last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold ui-color-primary">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && isSafeHttpUrl(href)) {
          openUrl(href).catch((err) => {
            console.error("Failed to open link:", err);
          });
        }
      }}
      className="ui-color-info-strong hover:underline cursor-pointer"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <OrderedListContext.Provider value={false}>
      <ul className="space-y-2.5 mb-4 ml-1 last:mb-0">{children}</ul>
    </OrderedListContext.Provider>
  ),
  ol: ({ children }) => (
    <OrderedListContext.Provider value={true}>
      <ol className="space-y-2.5 mb-4 ml-1 list-decimal list-inside last:mb-0">
        {children}
      </ol>
    </OrderedListContext.Provider>
  ),
  li: MarkdownListItem,
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded-sm bg-surface-elevated ui-text-body-sm font-mono ui-color-primary">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-md bg-surface-elevated p-3 ui-text-body-sm [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-border-secondary pl-3 ui-color-muted">
      {children}
    </blockquote>
  ),
  hr: () => <div className="border-t border-border-primary my-4" />,
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse ui-text-body-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border-secondary px-3 py-1.5 text-left font-semibold ui-color-primary">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border-secondary px-3 py-1.5 ui-color-secondary">
      {children}
    </td>
  ),
};

export default function ReleaseNotesMarkdown({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={markdownPlugins.remark}
      components={markdownComponents}
    >
      {body}
    </ReactMarkdown>
  );
}
