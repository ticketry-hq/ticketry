import type { ComponentProps } from "react";

export function safeExternalHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

type SafeExternalLinkProps = Omit<
  ComponentProps<"a">,
  "href" | "target" | "rel"
> & {
  href: string;
};

export function SafeExternalLink({ href, children, ...props }: SafeExternalLinkProps) {
  const safeHref = safeExternalHref(href);
  if (!safeHref) return null;

  return (
    <a
      {...props}
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
