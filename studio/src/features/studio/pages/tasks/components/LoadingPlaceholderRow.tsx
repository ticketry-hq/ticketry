import React from "react";

interface LoadingPlaceholderRowProps {
  depth: number;
}

export const LoadingPlaceholderRow = React.memo(function LoadingPlaceholderRow({
  depth,
}: LoadingPlaceholderRowProps) {
  return (
    <li
      role="treeitem"
      className="text-text-muted [content-visibility:auto] [contain-intrinsic-size:auto_1.5rem]"
      style={{ paddingLeft: `${depth * 2}ch` }}
    >
      …
    </li>
  );
});
