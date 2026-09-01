#!/usr/bin/env python3
"""Retired compatibility entry point for the old Core-owned schema migration."""

import sys


ERROR_CODE = "CORE_WRITE_PROHIBITED"


def print_help():
    print("""Memory System v2.0 Schema Migration (retired)

The historical migration created memory-engine metadata in OpenClaw Core.
Core storage is read-only from memory-engine; lifecycle state belongs in the
Engine database. No migration or write protocol is available.
""")


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if "--help" in args or "-h" in args:
        print_help()
        return 0
    print(ERROR_CODE, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
