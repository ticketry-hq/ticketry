import os
from pathlib import Path

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.staticfiles.views import serve as serve_static
from django.http import FileResponse
from django.urls import include, path, re_path
from django.views.static import serve

# API + admin first so they always win over the SPA catch-all below.
# Dev media serving resolves local attachment URLs (C6).

urlpatterns = [
    path("api/work-tracker/", include("worktracker.rest.urls")),
    path("api/", include("apps.rest_urls")),
]
if settings.ADMIN_ENABLED:
    urlpatterns.append(path("wt-admin/", admin.site.urls))
urlpatterns.append(path("static/<path:path>", serve_static, {"insecure": True}))
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)


def _spa(request, path=""):
    """Serve the built Vite bundle with index.html fallback.

    Real files (``assets/...``) are served from disk; any other path
    returns ``index.html`` so client-side routing works on reload.

    :param request: the inbound HTTP request.
    :param path: the requested path relative to the static root.
    :return: the matching static file or the SPA entrypoint.
    """

    candidate = _static_root / path

    if path and candidate.is_file():
        return serve(request, path, document_root=str(_static_root))

    return FileResponse(open(_static_root / "index.html", "rb"))


# Deployed mode only: serve the baked frontend when the env var
# names an existing dist/. Dev is unaffected — there Vite proxies to us.

_static_dir = os.environ.get("MUXED_STATIC_DIR", "")

if _static_dir and Path(_static_dir).is_dir():
    _static_root = Path(_static_dir)

    urlpatterns += [re_path(r"^(?P<path>.*)$", _spa)]
