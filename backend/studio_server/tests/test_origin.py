from django.test import Client, override_settings


TRUSTED_ORIGIN = "http://127.0.0.1:5174"


@override_settings(MUXED_DESKTOP_ORIGIN=TRUSTED_ORIGIN)
def test_desktop_origin_preflight_allows_the_trusted_webview():
    response = Client().options(
        "/api/config",
        HTTP_ORIGIN=TRUSTED_ORIGIN,
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="x-api-key",
    )

    assert response.status_code == 204
    assert response["Access-Control-Allow-Origin"] == TRUSTED_ORIGIN
    assert "x-api-key" in response["Access-Control-Allow-Headers"]
    assert "GET" in response["Access-Control-Allow-Methods"]
    assert "Origin" in response["Vary"]


@override_settings(MUXED_DESKTOP_ORIGIN=TRUSTED_ORIGIN)
def test_desktop_origin_adds_cors_headers_to_trusted_responses():
    response = Client().get("/api/healthz", HTTP_ORIGIN=TRUSTED_ORIGIN)

    assert response.status_code == 200
    assert response["Access-Control-Allow-Origin"] == TRUSTED_ORIGIN


@override_settings(MUXED_DESKTOP_ORIGIN=TRUSTED_ORIGIN)
def test_desktop_origin_rejects_an_untrusted_webview():
    response = Client().get(
        "/api/healthz",
        HTTP_ORIGIN="http://untrusted.invalid",
    )

    assert response.status_code == 403
    assert "Access-Control-Allow-Origin" not in response
