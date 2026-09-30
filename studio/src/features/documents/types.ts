/**
 * One registered design document as the workspace renders it.
 *
 * The registry publishes an identity and a root-relative path; the absolute
 * design-directory root and the run that discovered it stay inside the
 * runtime. `label` is derived from `rel_path` rather than stored, so a tab can
 * never disagree with the file it opens.
 */
export interface DesignDoc {
  id: string;
  rel_path: string;
  label: string;
  /**
   * The bytes the registry describes, or `null` where the runtime has not
   * fingerprinted them.
   *
   * A viewer keys its loaded content on this. An external rewrite moves neither
   * the document's identity nor its path, so without a version on the row a
   * refreshed registry would be indistinguishable from the one already
   * rendered, and the tab would keep showing content that is no longer on disk.
   */
  content_digest?: string | null;
}
