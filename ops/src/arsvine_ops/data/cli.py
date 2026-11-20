"""Provision Web data services."""

import argparse

from . import provision


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    provision_parser = commands.add_parser("provision", help=provision.__doc__)
    provision.add_arguments(provision_parser)

    args = parser.parse_args()
    provision.command(args, provision_parser)
