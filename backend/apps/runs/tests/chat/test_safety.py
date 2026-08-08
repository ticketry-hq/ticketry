from apps.runs.chat.safety import REDACTED, sanitize_external_message


def test_external_message_redacts_compound_environment_credentials():
    message = (
        "AWS_SECRET_ACCESS_KEY=aws-private; "
        "AWS_ACCESS_KEY_ID='aws-id'; "
        'MUXED_SECRET_KEY="django-private"; '
        "PRIVATE_KEY=signing-private; "
        "apiKey=provider-private; tokenUsage=123"
    )

    sanitized = sanitize_external_message(message)

    for secret in (
        "aws-private",
        "aws-id",
        "django-private",
        "signing-private",
        "provider-private",
    ):
        assert secret not in sanitized
    assert sanitized.count(REDACTED) == 5
    # A non-secret usage metric is not accidentally swallowed by the
    # environment-assignment rule.
    assert "tokenUsage=123" in sanitized
