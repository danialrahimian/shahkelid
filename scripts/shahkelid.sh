#!/usr/bin/env bash
# shahkelid: install and run Shah Kelid on a server, with one command.
#
#   sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/danialrahimian/shahkelid/main/scripts/shahkelid.sh)" @ install
#
# Installing asks for three things: the domain, and a username and a
# password for the shop's owner. Everything else (mail, Telegram, payment
# accounts, backups) is set and tested in the staff area afterwards, at
# /staff/settings. The command then stays on the server as `shahkelid`:
#
#   shahkelid install            install (asks for the domain and the owner)
#   shahkelid update             the latest release: code, images, migrations
#   shahkelid status | logs [service] | up | down | restart
#   shahkelid backup             a backup now, to every destination set up
#   shahkelid backups [s3]       the backups there are
#   shahkelid restore [latest|<id>|<file.skb>] [--s3]
#   shahkelid owner [list|password|reset-2fa|create] [username]
#   shahkelid domains [list|add|remove] [domain]
#   shahkelid edit-env           edit .env, then restart
#   shahkelid fix-dns            DNS inside the containers (for certificates)
#   shahkelid uninstall          remove it (backups on this server are kept)
#   shahkelid version | help
#
# Unattended install: shahkelid install --domain shop.example --username boss
#   --password-stdin --yes   (the password on standard input).
#
# Everything an install prints goes to /var/log/shahkelid-install.log as
# well, except the backup password.
#
# All of it is inside functions, called on the last line: when the script
# comes through a pipe, bash has read all of it before running any of it.

set -euo pipefail
export LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

REPO_URL=${SK_REPO:-https://github.com/danialrahimian/shahkelid.git}
BRANCH=${SK_BRANCH:-main}
CONF=/etc/shahkelid/cli.conf
LOG=/var/log/shahkelid-install.log
REPORT=/root/shahkelid-install.txt
APP_DIR=/opt/shahkelid
ASSUME_YES=0
B='' G='' Y='' R='' C='' N=''
STEP=0

# ===================================================================== output

ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die() {
  DYING=1
  printf '\n%s✗ %s%s\n' "$R" "$*" "$N" >&2
  exit 1
}
section() { printf '\n%s━━ %s%s\n' "$B" "$*" "$N"; }
step() {
  STEP=$((STEP + 1))
  printf '\n%s[%s] %s%s\n' "$B$C" "$STEP" "$*" "$N"
}

colours() {
  if [ -t 1 ]; then B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' C=$'\e[36m' N=$'\e[0m'; fi
}

# Answers come from the terminal even when the script arrives on standard
# input (curl … | bash); with no terminal, from standard input.
open_input() {
  if (: < /dev/tty) 2> /dev/null; then exec 3< /dev/tty; else exec 3<&0; fi
}

load_conf() {
  if [ -r "$CONF" ]; then
    # shellcheck disable=SC1090
    . "$CONF"
  fi
  PROD="$APP_DIR/infra/production"
}

need_root() {
  [ "$(id -u)" -eq 0 ] || die "Run as root: sudo shahkelid $*"
}

need_install() {
  [ -f "$PROD/.env" ] || die "Shah Kelid is not installed here. Install: shahkelid install"
}

sk() { "$PROD/sk" "$@"; }

# ================================================================== questions

trim() {
  local v=$1
  v=${v#"${v%%[![:space:]]*}"}
  v=${v%"${v##*[![:space:]]}"}
  printf '%s' "$v"
}

# ask VAR "question" [default] [hidden]
# Its own variable is __reply, so a caller's VAR of any other name is set
# (a local of the same name would take the answer instead).
ask() {
  local var=$1 question=$2 default=${3:-} hidden=${4:-} __reply
  printf '  %s?%s %s' "$B" "$N" "$question"
  [ -z "$default" ] || printf ' [%s]' "$default"
  printf ': '
  if [ "$hidden" = hidden ]; then
    IFS= read -r -s -u 3 __reply || die "No answer came"
    if [ -t 3 ]; then printf '\n'; else printf '****\n'; fi
  else
    IFS= read -r -u 3 __reply || die "No answer came"
    [ -t 3 ] || printf '%s\n' "$__reply"
  fi
  __reply=$(trim "$__reply")
  [ -n "$__reply" ] || __reply=$default
  printf -v "$var" '%s' "$__reply"
}

confirm() { # confirm "question" y|n
  local answer
  if [ "$ASSUME_YES" = 1 ]; then [ "$2" = y ]; return; fi
  ask answer "$1 (y/n)" "$2"
  case ${answer,,} in y | yes) return 0 ;; *) return 1 ;; esac
}

valid_domain() { [[ ${1,,} =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$ ]]; }
valid_ip() { [[ $1 =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; }
valid_username() { [[ $1 =~ ^[a-z0-9._-]{3,32}$ ]]; }

ask_domain() {
  local answer
  while :; do
    ask answer "The site's domain (like shop.example.com; or the server's IP for a trial)" "${SERVER_IP:-}"
    answer=${answer,,}
    answer=${answer#http://}
    answer=${answer#https://}
    answer=${answer%%/*}
    if valid_domain "$answer" || valid_ip "$answer" || [ "$answer" = localhost ]; then
      DOMAIN=$answer
      return 0
    fi
    warn "A domain like shop.example.com, without https://"
  done
}

ask_username() {
  local answer
  while :; do
    ask answer "The owner's username (lowercase letters, digits, . - _)" "admin"
    answer=${answer,,}
    if valid_username "$answer"; then
      OWNER_USERNAME=$answer
      return 0
    fi
    warn "3 to 32 of a-z, 0-9, dot, dash and underscore"
  done
}

ask_password() { # VAR
  local first second
  while :; do
    ask first "Password (at least 8 characters; not shown)" "" hidden
    if [ "${#first}" -lt 8 ] || [ "${#first}" -gt 128 ]; then
      warn "The password needs 8 to 128 characters."
      continue
    fi
    ask second "The same password again" "" hidden
    if [ "$first" = "$second" ]; then
      printf -v "$1" '%s' "$first"
      return 0
    fi
    warn "The two did not match."
  done
}

# ===================================================================== checks

public_ipv4() {
  local url ip
  for url in https://api.ipify.org https://ipv4.icanhazip.com https://ifconfig.me/ip; do
    ip=$(curl -4 -fsS -m 8 "$url" 2> /dev/null | tr -d '[:space:]') || true
    if valid_ip "$ip"; then
      printf '%s' "$ip"
      return 0
    fi
  done
  return 1
}
ipv4_of() { getent ahostsv4 "$1" 2> /dev/null | awk '{print $1}' | sort -u | paste -sd' ' - || true; }

CF_V4=''
cloudflare_ranges() {
  [ -n "$CF_V4" ] || CF_V4=$(curl -fsS -m 10 https://www.cloudflare.com/ips-v4 2> /dev/null || true)
  printf '%s' "$CF_V4"
}
ip_number() {
  local IFS=.
  # shellcheck disable=SC2086
  set -- $1
  printf '%s' $((($1 << 24) + ($2 << 16) + ($3 << 8) + $4))
}
in_range() {
  local ip net bits mask
  ip=$(ip_number "$1")
  net=$(ip_number "${2%/*}")
  bits=${2#*/}
  mask=$(((0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF))
  [ $((ip & mask)) -eq $((net & mask)) ]
}
is_cloudflare() {
  local range
  for range in $(cloudflare_ranges); do
    in_range "$1" "$range" && return 0
  done
  return 1
}

preflight() {
  section "Checking the server"
  local os=unknown mem disk ports
  [ -r /etc/os-release ] && os=$(. /etc/os-release && printf '%s %s' "$ID" "${VERSION_ID:-}")
  case $os in
    ubuntu* | debian*) ok "$os" ;;
    *) warn "Tested on Ubuntu, not $os." ;;
  esac
  case $(uname -m) in
    x86_64 | aarch64) ;;
    *) die "The $(uname -m) processor is not supported." ;;
  esac
  mem=$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
  if [ "$mem" -lt 1800 ]; then warn "Memory is $mem MB; 2 GB is needed."; else ok "Memory: $mem MB"; fi
  disk=$(df -Pm / | awk 'NR == 2 {print $4}')
  [ "$disk" -ge 8000 ] || die "Only $((disk / 1024)) GB of disk is free; at least 8 GB is needed."
  ok "Free disk: $((disk / 1024)) GB"
  ports=$(ss -Hltnp '( sport = :80 or sport = :443 )' 2> /dev/null | grep -v docker-proxy || true)
  if [ -n "$ports" ]; then
    printf '%s\n' "$ports"
    die "Port 80 or 443 is taken (above). Stop that program (systemctl disable --now nginx, say)."
  fi
  ok "Ports 80 and 443 are free"
  if ! command -v curl > /dev/null || ! command -v git > /dev/null || ! command -v openssl > /dev/null; then
    quietly apt-get -o DPkg::Lock::Timeout=600 update -q
    quietly apt-get -o DPkg::Lock::Timeout=600 install -y -q curl git openssl ca-certificates
  fi
  SERVER_IP=${SK_SERVER_IP:-$(public_ipv4 || true)}
  [ -n "$SERVER_IP" ] && ok "Server IP: $SERVER_IP"
}

# Where the domain points. Sets CLOUDFLARE=1 when it is behind Cloudflare's
# proxy, WWW=1 when www points here too.
check_dns() {
  CLOUDFLARE=0 WWW=0 TRIAL=0
  if valid_ip "$DOMAIN" || [ "$DOMAIN" = localhost ]; then
    TRIAL=1
    warn "A trial on $DOMAIN: the server signs its own certificate and browsers warn. For real sales, install with a domain."
    return 0
  fi
  section "Checking DNS"
  while :; do
    local found first
    found=$(ipv4_of "$DOMAIN")
    first=${found%% *}
    if [ -z "$found" ]; then
      warn "$DOMAIN has no A record yet."
    elif [ "$found" = "$SERVER_IP" ]; then
      ok "$DOMAIN → $found"
      break
    elif is_cloudflare "$first"; then
      CLOUDFLARE=1
      ok "$DOMAIN → $found (Cloudflare)"
      note "It is behind Cloudflare: Cloudflare's ranges are trusted, so the visitor's real address is seen."
      note "If the certificate fails, turn off \"Always Use HTTPS\" in Cloudflare, or grey the cloud until the install is done."
      break
    else
      warn "$DOMAIN points at $found, but this server is $SERVER_IP."
    fi
    note "Point the domain's A record at $SERVER_IP. Without it no HTTPS certificate can be issued."
    if [ "$ASSUME_YES" = 1 ] || ! confirm "Check again? (n: go on anyway)" y; then
      break
    fi
    sleep 3
  done
  local www
  www=$(ipv4_of "www.$DOMAIN")
  if [[ $DOMAIN != www.* ]] && [ -n "$www" ] && { [ "$www" = "$SERVER_IP" ] || is_cloudflare "${www%% *}"; }; then
    WWW=1
    ok "www.$DOMAIN comes here too, and was added."
  fi
}

# ===================================================================== install

quietly() {
  local out
  if ! out=$("$@" < /dev/null 2>&1); then
    printf '%s\n' "$out" | tail -n 25
    return 1
  fi
}

install_system() {
  step "Updating the system"
  local apt=(apt-get -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -y -q)
  quietly "${apt[@]}" update
  quietly "${apt[@]}" upgrade
  quietly "${apt[@]}" install git curl openssl ca-certificates ufw
  ok "Up to date"

  local mem
  mem=$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
  if [ "$mem" -lt 3500 ] && [ -z "$(swapon --show --noheadings 2> /dev/null)" ]; then
    if { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile; } > /dev/null 2>&1; then
      grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      ok "Made 2 GB of swap (memory is low)"
    else
      rm -f /swapfile
    fi
  fi
}

install_firewall() {
  [ "${SK_FIREWALL:-y}" = y ] || return 0
  step "Firewall"
  # Every port SSH may be on, asked four ways: the firewall must never lock
  # out the person running it. (Since Ubuntu 22.10 systemd, not sshd, holds
  # the listening socket, so the open sessions and sshd's settings count.)
  local ports port
  ports=$(
    {
      ss -Hltnp 2> /dev/null | awk '/"sshd/ {n = split($4, a, ":"); print a[n]}'
      ss -Htnp state established 2> /dev/null | awk '/"sshd/ {n = split($3, a, ":"); print a[n]}'
      sshd -T 2> /dev/null | awk '$1 == "port" {print $2}'
      [ -z "${SSH_CONNECTION:-}" ] || printf '%s\n' "${SSH_CONNECTION##* }"
    } | grep -E '^[0-9]+$' | sort -un || true
  )
  [ -n "$ports" ] || ports=22
  for port in $ports; do
    ufw allow "$port/tcp" > /dev/null
    ok "SSH: $port/tcp"
  done
  ufw allow 80/tcp > /dev/null
  ufw allow 443/tcp > /dev/null
  ufw allow 443/udp > /dev/null
  if ufw --force enable < /dev/null > /dev/null 2>&1; then
    ok "Only SSH, 80 and 443 are open"
  else
    warn "The firewall could not be turned on; use your provider's."
  fi
}

install_docker() {
  step "Docker"
  if ! docker compose version > /dev/null 2>&1; then
    local script
    script=$(mktemp)
    if ! { curl -fsSL --retry 4 --retry-delay 3 --retry-all-errors -o "$script" https://get.docker.com && quietly sh "$script"; }; then
      warn "get.docker.com failed; installing from Ubuntu's repository."
      quietly apt-get -o DPkg::Lock::Timeout=600 install -y -q docker.io docker-compose-v2
    fi
    rm -f "$script"
    systemctl enable --now docker > /dev/null 2>&1 || true
  fi
  docker compose version > /dev/null 2>&1 || die "Docker could not be installed."
  ok "$(docker compose version)"
  container_dns
}

# ======================================================================== dns

# The containers look names up through Docker's own DNS (127.0.0.11), which
# asks the host's servers, or 8.8.8.8 and 8.8.4.4 when the host's are on
# loopback (systemd-resolved, dnsmasq). Where those cannot be reached, every
# lookup inside fails ("server misbehaving") and Caddy never gets a
# certificate, though the host itself resolves fine. So it is checked, and
# when it fails Docker is given DNS servers that answer from a container.
DNS_PROBE=acme-v02.api.letsencrypt.org
DNS_IMAGE=redis:7-alpine

# Lookups on a network of its own, as the services do theirs.
dns_works_inside() {
  local ok=1
  docker network create shahkelid-dns-check > /dev/null 2>&1 || true
  timeout 60 docker run --rm --network shahkelid-dns-check "$DNS_IMAGE" getent hosts "$DNS_PROBE" > /dev/null 2>&1 || ok=0
  docker network rm shahkelid-dns-check > /dev/null 2>&1 || true
  [ "$ok" = 1 ]
}

# The host's own servers first (not loopback ones), then public ones.
dns_candidates() {
  {
    local file
    for file in /run/systemd/resolve/resolv.conf /etc/resolv.conf; do
      [ ! -r "$file" ] || awk '$1 == "nameserver" {print $2}' "$file"
    done
    printf '%s\n' 1.1.1.1 8.8.8.8 9.9.9.9 1.0.0.1 8.8.4.4
  } | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -v '^127\.' | awk '!seen[$0]++'
}

# write_daemon_dns "1.1.1.1" "8.8.8.8": the "dns" key of /etc/docker/daemon.json,
# keeping whatever else is in it.
write_daemon_dns() {
  local file=/etc/docker/daemon.json
  mkdir -p /etc/docker
  if [ -s "$file" ]; then
    command -v python3 > /dev/null || return 1
    python3 - "$file" "$@" << 'PY' || return 1
import json, sys
path, servers = sys.argv[1], sys.argv[2:]
with open(path) as f:
    config = json.load(f)
config["dns"] = servers
with open(path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PY
  else
    local list
    list=$(printf '"%s", ' "$@")
    printf '{\n  "dns": [%s]\n}\n' "${list%, }" > "$file"
  fi
}

container_dns() {
  quietly docker pull -q "$DNS_IMAGE" || { warn "Could not pull $DNS_IMAGE to check DNS inside containers."; return 0; }
  if dns_works_inside; then
    ok "DNS works inside containers"
    return 0
  fi
  warn "Containers cannot look up names (Docker's DNS gets no answer); finding DNS servers that do."
  local server working=()
  for server in $(dns_candidates); do
    if timeout 20 docker run --rm --dns "$server" "$DNS_IMAGE" getent hosts "$DNS_PROBE" > /dev/null 2>&1; then
      working+=("$server")
      [ "${#working[@]}" -lt 3 ] || break
    fi
  done
  if [ "${#working[@]}" -eq 0 ]; then
    warn "No DNS server answered from inside a container. Certificates cannot be issued until one does."
    note "Put a DNS server that works on this network in /etc/docker/daemon.json, like {\"dns\": [\"1.1.1.1\"]}, then: systemctl restart docker"
    return 0
  fi
  if ! write_daemon_dns "${working[@]}"; then
    warn "Could not update /etc/docker/daemon.json; add \"dns\": [\"${working[0]}\"] to it, then: systemctl restart docker"
    return 0
  fi
  systemctl restart docker
  if dns_works_inside; then
    ok "Docker now uses these DNS servers: ${working[*]} (/etc/docker/daemon.json)"
  else
    warn "Still no DNS inside containers, even with ${working[*]}. See /etc/docker/daemon.json."
  fi
}

install_code() {
  step "The code"
  local here
  here=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]:-/nonexistent}")")/.." 2> /dev/null && pwd || true)
  if [ -z "${SK_REPO:-}" ] && [ -n "$here" ] && [ -x "$here/infra/production/sk" ]; then
    APP_DIR=$here
    ok "This checkout: $APP_DIR"
  elif [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" pull --ff-only -q < /dev/null || true
    ok "$APP_DIR"
  else
    GIT_TERMINAL_PROMPT=0 git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR" < /dev/null ||
      die "Could not get the code from $REPO_URL."
    ok "$APP_DIR"
  fi
  PROD="$APP_DIR/infra/production"
  chmod 750 "$APP_DIR"
  chmod +x "$PROD/sk" "$APP_DIR/scripts/shahkelid.sh"
}

configure() {
  step "Settings"
  local sites="$DOMAIN"
  [ "$WWW" = 0 ] || sites="$DOMAIN, www.$DOMAIN"
  if [ "$TRIAL" = 1 ] && [ "$DOMAIN" != localhost ]; then sites="$DOMAIN, localhost"; fi
  [ "$RESUME" = 1 ] || (cd "$PROD" && ./sk init > /dev/null < /dev/null)
  set_env MAIN_DOMAIN "$DOMAIN"
  set_env SITE_ADDRESSES "$sites"
  if [ "$TRIAL" = 1 ]; then set_env CADDY_LOCAL_CERTS local_certs; fi
  if [ "$CLOUDFLARE" = 1 ]; then
    local ranges
    ranges=$(curl -fsS -m 15 https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6 2> /dev/null | tr '\n' ' ' || true)
    [ -z "$(trim "$ranges")" ] || set_env TRUSTED_PROXIES "$(trim "$ranges")"
  fi
  mkdir -p /var/lib/shahkelid/backups
  chmod 700 /var/lib/shahkelid /var/lib/shahkelid/backups
  ok "$PROD/.env ($sites)"
}

# set_env KEY VALUE: one line of .env, replaced in place (mode stays 600).
set_env() {
  local line="$1=$2"
  [[ $2 =~ ^[A-Za-z0-9_./:@,+=%-]*$ ]] || line="$1='$2'"
  KEY=$1 LINE=$line awk '
    BEGIN { key = ENVIRON["KEY"] "="; line = ENVIRON["LINE"] }
    index($0, key) == 1 { print line; done = 1; next }
    { print }
    END { if (!done) print line }
  ' "$PROD/.env" > "$PROD/.env.next"
  cat "$PROD/.env.next" > "$PROD/.env"
  rm -f "$PROD/.env.next"
}
env_value() { grep -E "^$1=" "$PROD/.env" | head -n 1 | cut -d= -f2- | sed "s/^'//; s/'\$//"; }

start() {
  step "Building and starting (a few minutes the first time)"
  # Three tries: the first build downloads a few hundred MB, and one dropped
  # connection should not end the install.
  local attempt
  for attempt in 1 2 3; do
    if sk up < /dev/null; then
      ok "Every service is up"
      return 0
    fi
    [ "$attempt" = 3 ] || warn "Starting did not finish; trying again ($((attempt + 1)) of 3)…"
    sleep 10
  done
  sk status < /dev/null || true
  die "Starting did not finish (above). Logs: shahkelid logs app — once it is fixed, run the same install command again."
}

make_owner() {
  step "The owner's account"
  local out
  if out=$(printf '%s\n' "$OWNER_PASSWORD" | sk owner create "$OWNER_USERNAME" 2>&1); then
    ok "$OWNER_USERNAME"
  elif [ "$RESUME" = 1 ] && grep -q "exists already" <<< "$out"; then
    # A resumed install whose owner was made the first time round.
    ok "The owner's account was made already"
  else
    printf '%s\n' "$out"
    die "Could not make the owner's account."
  fi
}

check_site() {
  step "Checking the site"
  # Asked of this server itself; a real domain with a real certificate check.
  local url="https://$DOMAIN/health" args=(--resolve "$DOMAIN:443:127.0.0.1")
  if [ "$TRIAL" = 1 ]; then url=https://localhost/health args=(-k); fi
  for _ in $(seq 1 30); do
    if curl -fsS -m 10 "${args[@]}" -o /dev/null "$url" < /dev/null 2> /dev/null; then
      SITE_OK=1
      ok "The site answers over HTTPS"
      return 0
    fi
    sleep 4
  done
  SITE_OK=0
  warn "No valid certificate yet; usually the DNS has not arrived. Caddy keeps trying: shahkelid logs web"
}

link_command() {
  mkdir -p /etc/shahkelid
  printf "APP_DIR='%s'\n" "$APP_DIR" > "$CONF"
  chmod 644 "$CONF"
  ln -sf "$APP_DIR/scripts/shahkelid.sh" /usr/local/bin/shahkelid
}

report() {
  local site="https://$DOMAIN" password
  password=$(env_value RESTIC_PASSWORD)
  umask 077
  {
    printf '%s\n\n' "Shah Kelid is installed — $(date '+%Y-%m-%d %H:%M')"
    printf '%s %s\n' "Site:" "$site"
    printf '%s %s/staff\n' "Staff area:" "$site"
    printf '%s %s\n\n' "Username:" "$OWNER_USERNAME"
    printf '%s\n' "1. Sign in with the username and password, and set up two-step sign-in with Google Authenticator or 2FAS."
    printf '%s\n' "2. In Settings, set up and test mail (SMTP), Telegram, the payment accounts and backups."
    printf '%s\n\n' "3. Add the PasarGuard panel, servers and plans."
    printf '%s\n' "The backup password — keep it away from this server (a password manager). With it alone, any backup comes back on any new server:"
    printf '  %s\n\n' "$password"
    [ "$TRIAL" = 0 ] || printf '%s\n\n' "This is a trial install (self-signed certificate)."
    [ "$CLOUDFLARE" = 0 ] || printf '%s\n\n' "Cloudflare: choose Full (strict) under SSL/TLS."
    [ "${SITE_OK:-1}" = 1 ] || printf '%s\n\n' "The site did not answer over HTTPS yet: shahkelid logs web"
    [ ! -f /var/run/reboot-required ] || printf '%s\n\n' "A system update wants a restart: reboot (the site comes back by itself)."
    printf '%s\n' "Commands: shahkelid help"
  } > "$REPORT"
  {
    printf '\n%s%s%s\n' "$B$G" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "$N"
    cat "$REPORT"
    printf '%s%s%s\n' "$B$G" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "$N"
    printf '%s\n' "The same is in $REPORT (root only). Delete it once the password is saved."
  } >&4
}

cmd_install() {
  need_root install
  local password_stdin=0
  DOMAIN=${SK_DOMAIN:-} OWNER_USERNAME=${SK_USERNAME:-}
  while [ $# -gt 0 ]; do
    case $1 in
      --domain) DOMAIN=$2; shift 2 ;;
      --username) OWNER_USERNAME=$2; shift 2 ;;
      --password-stdin) password_stdin=1; shift ;;
      --lang) shift 2 ;; # the output is English only; kept for old scripts
      --yes) ASSUME_YES=1; shift ;;
      *) die "Unknown option: $1" ;;
    esac
  done
  if [ "$password_stdin" = 1 ]; then IFS= read -r OWNER_PASSWORD || true; fi
  open_input
  touch "$LOG" && chmod 600 "$LOG"
  exec 4>&1
  exec > >(tee -a "$LOG") 2>&1

  printf '\n%s%s%s\n' "$B" "Installing Shah Kelid" "$N"

  # Installed already (the command is in place): nothing to do here. A
  # .env without it is an install that stopped half way (a download that
  # failed, say): it carries on, keeping the secrets it made.
  RESUME=0
  if [ -f "$PROD/.env" ]; then
    if [ -r "$CONF" ]; then
      die "Shah Kelid is installed already ($APP_DIR). For the latest: shahkelid update"
    fi
    RESUME=1
    warn "An earlier install stopped half way; carrying on from there (the secrets it made are kept)."
  fi
  preflight

  section "Three questions"
  if [ -n "$DOMAIN" ]; then
    DOMAIN=${DOMAIN,,}
    valid_domain "$DOMAIN" || valid_ip "$DOMAIN" || [ "$DOMAIN" = localhost ] || die "Not a domain: $DOMAIN"
  else
    ask_domain
  fi
  if [ -n "$OWNER_USERNAME" ]; then
    OWNER_USERNAME=${OWNER_USERNAME,,}
    valid_username "$OWNER_USERNAME" || die "Not a username: $OWNER_USERNAME"
  else
    ask_username
  fi
  if [ -n "${OWNER_PASSWORD:-}" ]; then
    [ "${#OWNER_PASSWORD}" -ge 8 ] || die "The password needs at least 8 characters."
  else
    ask_password OWNER_PASSWORD
  fi
  check_dns

  note "Now about 10 minutes with no questions: updates, firewall, Docker, building and starting."
  confirm "Start?" y || die "Nothing was changed."

  install_system
  install_firewall
  install_docker
  install_code
  configure
  start
  make_owner
  link_command
  check_site
  report
}

# =================================================================== commands

cmd_update() {
  need_root update
  need_install
  section "Updating"
  (cd "$PROD" && ./sk update)
  ok "Now on the latest release."
}

cmd_fix_dns() {
  need_root fix-dns
  need_install
  section "DNS inside containers"
  container_dns
  # A restarted Docker brings the services back by itself; this waits for it.
  sk up < /dev/null > /dev/null && ok "Every service is up"
  note "Caddy asks for the certificate again within a few minutes: shahkelid logs web"
}

cmd_restore() {
  need_root restore
  need_install
  local what="" from=local password="" own
  while [ $# -gt 0 ]; do
    case $1 in
      --s3) from=s3; shift ;;
      *) what=$1; shift ;;
    esac
  done
  open_input
  own=$(env_value RESTIC_PASSWORD)
  if [ "$from" = s3 ] && [ -z "${SK_S3_REPOSITORY:-}" ]; then
    note "If this server does not know the bucket yet (a new server), give it; otherwise Enter."
    local endpoint bucket
    ask endpoint "endpoint (like https://s3.us-west-004.backblazeb2.com)" ""
    if [ -n "$endpoint" ]; then
      ask bucket "bucket" ""
      export SK_S3_REPOSITORY="s3:${endpoint%/}/$bucket"
      ask SK_S3_ACCESS_KEY_ID "Key ID" ""
      ask SK_S3_SECRET_ACCESS_KEY "Secret key" "" hidden
      ask SK_S3_REGION "Region" auto
      export SK_S3_ACCESS_KEY_ID SK_S3_SECRET_ACCESS_KEY SK_S3_REGION
    fi
  fi
  if [ -z "$what" ] || [ ! -f "$what" ]; then
    sk snapshots "$from" < /dev/null || true
    [ -n "$what" ] || ask what "Which backup? (latest is the newest, or an id from the first column)" latest
  fi
  ask password "The backup password (Enter: this server's)" "" hidden
  if [ -n "$password" ] && [ "$password" != "$own" ]; then export RESTORE_PASSWORD=$password; fi
  if [ -f "$what" ]; then
    (cd "$PROD" && ./sk restore --file "$(readlink -f "$what")" < /dev/fd/3)
  else
    (cd "$PROD" && ./sk restore "$what" --from "$from" < /dev/fd/3)
  fi
  ok "Restored."
}

cmd_owner() {
  need_root owner
  need_install
  local action=${1:-list} name=${2:-} password
  case $action in
    list) sk owner list < /dev/null ;;
    create | password)
      open_input
      if [ -z "$name" ]; then ask_username; name=$OWNER_USERNAME; fi
      ask_password password
      if [ "$action" = create ]; then
        printf '%s\n' "$password" | sk owner create "$name" --another
      else
        printf '%s\n' "$password" | sk owner password "$name"
      fi
      ;;
    reset-2fa)
      [ -n "$name" ] || die "shahkelid owner reset-2fa <username>"
      sk owner reset-2fa "$name" < /dev/null
      ;;
    *) die "shahkelid owner [list|password|reset-2fa|create] [username]" ;;
  esac
}

cmd_domains() {
  need_root domains
  need_install
  local action=${1:-list} domain=${2:-} sites
  sites=$(env_value SITE_ADDRESSES)
  case $action in
    list) printf '%s\n' "${sites//, /$'\n'}" ;;
    add | remove)
      domain=${domain,,}
      valid_domain "$domain" || die "shahkelid domains $action <domain>"
      if [ "$action" = add ]; then
        [[ ", $sites," == *", $domain,"* ]] && die "$domain is there already."
        SERVER_IP=$(public_ipv4 || true)
        [ "$(ipv4_of "$domain")" = "$SERVER_IP" ] || is_cloudflare "$(ipv4_of "$domain" | cut -d' ' -f1)" ||
          warn "$domain does not point here ($SERVER_IP) yet; its certificate comes once the DNS does."
        sites="$sites, $domain"
      else
        [ "$domain" != "$(env_value MAIN_DOMAIN)" ] || die "The main domain cannot be removed."
        sites=$(printf '%s' "$sites" | tr ',' '\n' | sed 's/^ *//' | grep -vx "$domain" | paste -sd, - | sed 's/,/, /g')
      fi
      set_env SITE_ADDRESSES "$sites"
      quietly sk up
      ok "Addresses: $sites"
      note "For new subscription links, set the domain under Panels in the staff area too."
      ;;
    *) die "shahkelid domains [list|add|remove] [domain]" ;;
  esac
}

cmd_edit_env() {
  need_root edit-env
  need_install
  "${EDITOR:-$(command -v nano || command -v vi)}" "$PROD/.env"
  open_input
  if confirm "Restart with the new settings?" y; then sk up; fi
}

cmd_uninstall() {
  need_root uninstall
  need_install
  open_input
  warn "The site, its database and its files on this server are removed. The backups on this server ($(env_value BACKUP_LOCAL_DIR)) are kept."
  local answer
  ask answer "Type uninstall to go on" ""
  [ "$answer" = uninstall ] || die "Nothing was changed."
  (cd "$PROD" && docker compose --env-file .env -f compose.yaml down -v --rmi local) || true
  rm -f /usr/local/bin/shahkelid "$CONF"
  [ "$APP_DIR" != / ] && rm -rf "$APP_DIR"
  ok "Removed."
}

usage() {
  cat << EOF
${B}shahkelid${N} — install and run Shah Kelid

  install                     install (the domain, the owner's username and password)
  update                      the latest release: code, images, database
  status                      what is running
  logs [app|worker|web|backup] the logs
  up | down | restart         start, stop, restart
  backup                      a backup now
  backups [s3]                the backups there are
  restore [latest|<id>|<file.skb>] [--s3]   restore (a file: the one the Telegram bot sent)
  owner [list|password|reset-2fa|create] [username]   the owners' accounts
  domains [list|add|remove] [domain]                 domains and backup domains
  edit-env                    edit .env
  fix-dns                     fix DNS inside the containers (no certificate)
  uninstall                   remove it
  version                     the version

Folder: $APP_DIR
EOF
}

main() {
  colours
  load_conf
  local command=${1:-help}
  [ $# -eq 0 ] || shift
  case $command in
    install) cmd_install "$@" ;;
    update) cmd_update ;;
    status) need_install && sk status ;;
    logs) need_install && sk logs "$@" ;;
    up | down | restart) need_root "$command" && need_install && sk "$command" ;;
    backup) need_root backup && need_install && sk backup ;;
    backups | snapshots) need_root backups && need_install && sk snapshots "${1:-local}" ;;
    restore) cmd_restore "$@" ;;
    owner) cmd_owner "$@" ;;
    domains) cmd_domains "$@" ;;
    edit-env) cmd_edit_env ;;
    fix-dns) cmd_fix_dns ;;
    uninstall) cmd_uninstall ;;
    version) git -C "$APP_DIR" log -1 --format='%h %cd' --date=short 2> /dev/null || echo "not installed" ;;
    help | -h | --help) usage ;;
    *)
      usage
      exit 2
      ;;
  esac
}

on_exit() {
  local code=$?
  if [ "$code" -ne 0 ] && [ -z "${DYING:-}" ]; then
    printf '\n%s✗ %s%s\n' "$R" "It stopped half way. Details: $LOG" "$N" >&2
  fi
}
trap on_exit EXIT

main "$@"
