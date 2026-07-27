#!/usr/bin/env python
import os
import sys


def main():
    """Run Django management commands."""
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "studio_server.settings")

    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
