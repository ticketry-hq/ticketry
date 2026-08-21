import json
import secrets
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from worktracker.services.onboarding import get_installation_default_project
from worktracker.services.projects import create_project
from worktracker.services.errors import NotFoundError


class Command(BaseCommand):
    """Idempotently provision the default project, optional admin, and token.

    Creates the minimum a fresh install needs and prints the connection fields
    the bootstrap (#539, S5) consumes. A second run is a no-op that re-prints
    the same values. Domain projects are created explicitly by users.
    """

    help = "Provision the owned worktracker backend (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--admin-username")
        parser.add_argument("--admin-password")

    def handle(self, *args, **options):
        """Run the idempotent installation steps and print the connection data."""

        # Step 1: ensure the installation's operational root. Existing rows
        # remain untouched; only a project created here enters onboarding.
        try:
            project = get_installation_default_project()
        except NotFoundError:
            project = create_project(name="Coding", slug="CDN")
            project.onboarding_required = True
            project.save(update_fields=["onboarding_required"])

        # Step 2: development-only admin superuser.

        user_model = get_user_model()
        if settings.ADMIN_ENABLED:
            if not options["admin_username"] or not options["admin_password"]:
                raise CommandError(
                    "admin-enabled provisioning requires explicit "
                    "--admin-username and --admin-password"
                )
            admin, created = user_model.objects.get_or_create(
                username=options["admin_username"],
                defaults={"is_staff": True, "is_superuser": True},
            )
            if created:
                admin.set_password(options["admin_password"])
                admin.save()
        else:
            # No admin surface means no admin credential. Hiding ``wt-admin/``
            # does not remove an account an earlier install created — and the
            # pre-T1419 defaults were literally admin/admin — so close every
            # administrative row here rather than rely on the URL staying off.
            user_model.objects.filter(
                Q(is_staff=True) | Q(is_superuser=True)
            ).update(is_staff=False, is_superuser=False, is_active=False)

        # Step 3: ensure the static API token, persisting once if generated.

        token = self._ensure_token()

        # Step 4: print the connection fields.

        self.stdout.write(
            json.dumps(
                {
                    "api_url": getattr(
                        settings,
                        "WORKTRACKER_API_URL",
                        "http://127.0.0.1:8787/api",
                    ),
                    "project_id": str(project.id),
                    "token": token,
                }
            )
        )

    def _ensure_token(self):
        """Return the API token, generating + persisting it once if unset.

        Prefers the env-fed ``WORKTRACKER_API_TOKEN``. When empty, reads (or
        generates and writes) a token at ``WORKTRACKER_TOKEN_FILE`` so the
        next run reads back the same value — keeping the token stable (C8).

        :return: the static API token to print.
        """

        token = getattr(settings, "WORKTRACKER_API_TOKEN", "")
        if token:
            return token

        token_file = getattr(settings, "WORKTRACKER_TOKEN_FILE", "")
        if token_file:
            token_file = Path(token_file)
            if token_file.exists():
                return token_file.read_text().strip()

            token = secrets.token_urlsafe(32)
            token_file.parent.mkdir(parents=True, exist_ok=True)
            token_file.write_text(token)
            return token

        # No persistence configured — generate an ephemeral token.

        return secrets.token_urlsafe(32)
