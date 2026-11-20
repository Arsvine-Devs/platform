"""Create a site repository that the Arsvine Web build workflow can deploy."""

import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal

import yaml

from arsvine_ops.build.site_release import HOSTNAME, IDENTIFIER, checked_branch, require_match

ASTRO_INDEX = """---
const title = "New site";
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title}</title>
  </head>
  <body><main><h1>{title}</h1></main></body>
</html>
"""

NEXT_LAYOUT = """export const metadata = { title: "New site" };

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
"""

VITE_INDEX = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>New site</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src.jsx"></script>
  </body>
</html>
"""

REACT = {"react": "19.3.1", "react-dom": "19.3.1"}


type Starter = Literal["astro", "next", "vite"]


def template(starter: Starter) -> tuple[dict[str, str], dict[str, str], str, str]:
    if starter == "astro":
        return {"astro": "7.4.13"}, {"src/pages/index.astro": ASTRO_INDEX}, "astro", "static"
    if starter == "next":
        return (
            {"next": "16.4.6", **REACT},
            {
                "next.config.mjs": (
                    'export default { output: "standalone", poweredByHeader: false, '
                    "agentRules: true, logging: { browserToTerminal: true } };\n"
                ),
                ".codex/config.toml": (
                    "[mcp_servers.next-devtools]\n"
                    'command = "npx"\nargs = ["-y", "next-devtools-mcp@0.4.0"]\n'
                ),
                ".mcp.json": (
                    '{"mcpServers":{"next-devtools":{"command":"npx",'
                    '"args":["-y","next-devtools-mcp@0.4.0"]}}}\n'
                ),
                "app/layout.jsx": NEXT_LAYOUT,
                "app/page.jsx": "export default function Page() { return <main><h1>New site</h1></main>; }\n",
                "app/health/ready/route.js": 'export function GET() { return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } }); }\n',
            },
            "next",
            "next",
        )
    return (
        {"vite": "8.3.8", **REACT},
        {
            "index.html": VITE_INDEX,
            "src.jsx": 'import React from "react";\nimport { createRoot } from "react-dom/client";\n\ncreateRoot(document.getElementById("root")).render(<main><h1>New site</h1></main>);\n',
        },
        "vite",
        "static",
    )


def workflow(branch: str) -> str:
    return f"""name: Web builds

on:
  push:
    branches: [{json.dumps(branch)}]
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment
        type: choice
        options: [preview, production]
        default: preview

permissions:
  contents: read

jobs:
  build:
    uses: Arsvine-Devs/platform/.github/workflows/build-web.yml@main
    with:
      environment: ${{{{ inputs.environment || 'production' }}}}
"""


def scaffold(destination: Path, name: str, hostname: str, branch: str, starter: Starter) -> None:
    require_match(IDENTIFIER, name, "site ID")
    require_match(HOSTNAME, hostname, "hostname")
    checked_branch(branch)
    if (
        destination.is_symlink()
        or destination.is_junction()
        or (destination.exists() and (not destination.is_dir() or any(destination.iterdir())))
    ):
        raise ValueError("Choose an empty destination directory")

    dependencies, source, cli, build_type = template(starter)
    package = {
        "name": name,
        "private": True,
        "type": "module",
        "engines": {"node": "26.x"},
        "packageManager": "pnpm@12.21.0",
        "scripts": {"dev": f"{cli} dev", "build": f"{cli} build"},
        "dependencies": dependencies,
    }
    manifest = {
        "version": 1,
        "services": [
            {
                "id": name,
                "runtime": "node" if build_type == "next" else "static",
                "production": {"branch": branch, "hostname": hostname},
                "health": "/health/ready" if build_type == "next" else "/",
                "capabilities": [],
                "build": {"type": build_type, "directory": "."},
            }
        ],
    }
    files = {
        **source,
        "package.json": json.dumps(package, indent=2) + "\n",
        "site.yaml": yaml.safe_dump(manifest, sort_keys=False),
        ".github/workflows/web.yml": workflow(branch),
        ".gitignore": "node_modules/\n.next/\ndist/\n.astro/\n.env*\n",
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".web-site-", dir=destination.parent) as temporary:
        candidate = Path(temporary)
        for filename, content in files.items():
            path = candidate / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        if destination.is_dir() and not destination.is_symlink() and not destination.is_junction():
            destination.rmdir()
        candidate.rename(destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project")
    parser.add_argument("hostname")
    parser.add_argument("--starter", choices=("astro", "next", "vite"), required=True)
    parser.add_argument("--branch", default="main")
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    try:
        scaffold(args.directory, args.project, args.hostname, args.branch, args.starter)
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")
    print(args.directory.resolve())
