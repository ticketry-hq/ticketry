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
      className="text-text-muted"
      style={{ paddingLeft: `${depth * 2}ch` }}
    >
      …
    </li>
  );
});
