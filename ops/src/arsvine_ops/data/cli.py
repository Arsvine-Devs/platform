"""Provision Web data services or stage a published-media import."""

import argparse

from . import media_import, provision


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    provision_parser = commands.add_parser("provision", help=provision.__doc__)
    provision.add_arguments(provision_parser)
    import_parser = commands.add_parser("import-media", help=media_import.__doc__)
    media_import.add_arguments(import_parser)

    args = parser.parse_args()
    if args.command == "provision":
        provision.command(args, provision_parser)
    else:
        media_import.command(args, import_parser)
