#!/usr/bin/env bash
# Installs Shah Kelid from this checkout:
#
#   sudo bash install.sh
#
# The same as `shahkelid install` (scripts/shahkelid.sh), which also installs
# straight from GitHub, with no checkout:
#
#   sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/danialrahimian/shahkelid/main/scripts/shahkelid.sh)" @ install
set -euo pipefail
exec bash "$(dirname "$(readlink -f "$0")")/scripts/shahkelid.sh" install "$@"
