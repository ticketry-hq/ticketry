from django.db import models


class DesignDocument(models.Model):
    """Persist one discovered design document."""

    id = models.CharField(primary_key=True)
    module_id = models.CharField()
    task_id = models.CharField()
    scope = models.CharField()
    root_dir = models.CharField()
    rel_path = models.CharField()
    discovered_by_run_id = models.CharField(null=True)
    created_at = models.CharField()
    updated_at = models.CharField()

    class Meta:
        db_table = "design_documents"
        constraints = [
            models.UniqueConstraint(
                fields=["root_dir", "rel_path"],
                name="uq_design_doc_path",
            ),
        ]
        indexes = [
            models.Index(
                fields=["task_id"],
                name="idx_design_documents_task",
            ),
        ]
