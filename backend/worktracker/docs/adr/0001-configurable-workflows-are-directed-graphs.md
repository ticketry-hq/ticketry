# Configurable workflows are directed graphs

Project workflow states remain shared, but each work-item type defines its own directed graph over them and a state may have multiple legal destinations. We rejected deriving transitions from one linear order because review loops, cancellation paths, and future branching workflows are first-class behavior; display order remains presentation metadata rather than transition authority.
