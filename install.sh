#!/usr/bin/env bash
# Shah Kelid on a fresh server, with one command:
#
#   curl -fsSL <raw address of this file> | sudo bash
#   sudo ./install.sh                     (from a checkout of the code)
#
# It asks everything first, all at once, then works alone for ten minutes or
# so. Each answer it can check is checked before anything on the server
# changes: the domain points at this server, the mail service delivers a code
# to your inbox, the Telegram bot answers, the backup bucket can be reached.
# Then: system updates, a firewall, Docker, the code, infra/production/.env,
# ./sk up, the first owner and a first backup. At the end it prints (and saves
# to a root-only file) the two secrets to keep away from the server.
#
# The same script moves a shop to a new server ("restore"): give it the two
# kept secrets and the same backups, and it brings the last backup back.
#
# Unattended: each question reads a variable first; set it beforehand (in the
# environment, or in a file passed as --answers FILE) to skip the question.
# SK_ASSUME_YES=1 takes the defaults, and stops on anything required that is
# missing instead of asking. The names are those of .env (MAIN_DOMAIN,
# SMTP_HOST, ZARINPAL_MERCHANT_ID…) plus a few of the installer's own:
#   SK_LANG fa|en   SK_MODE new|restore   SK_ADDRESS domain|trial
#   SK_REPO SK_BRANCH SK_DIR   SK_OWNER_EMAIL   SK_WWW y|n
#   SK_BACKUP_DOMAINS   SK_CLOUDFLARE y|n   SK_BACKUP s3|local
#   SK_S3_ENDPOINT SK_S3_BUCKET   SK_FIREWALL y|n   SK_SERVER_IP
#
# Everything it prints also goes to /var/log/shah-kelid-install.log, except
# the secrets.
#
# All of it is inside main(), called on the last line: when the script comes
# through a pipe, bash has then read all of it before running any of it.

set -euo pipefail
export LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

LOG=/var/log/shah-kelid-install.log
REPORT=/root/shah-kelid-install.txt
STEP=0
STARTED=$(date +%s)
UI_LANG=fa
B='' G='' Y='' R='' C='' N=''

# ==================================================================== output

# L "فارسی" "English": the text in the chosen language.
L() { if [ "$UI_LANG" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die() {
  DYING=1
  printf '\n%s✗ %s%s\n' "$R" "$*" "$N"
  exit 1
}
section() { printf '\n%s━━ %s%s\n' "$B" "$*" "$N"; }
step() {
  STEP=$((STEP + 1))
  printf '\n%s[%s] %s%s\n' "$B$C" "$STEP" "$*" "$N"
}

on_exit() {
  local code=$?
  if [ "$code" -ne 0 ] && [ -z "${DYING:-}" ]; then
    printf '\n%s✗ %s%s\n' "$R" "$(L "نصب در میانه متوقف شد. جزئیات: $LOG" "The install stopped half way. Details: $LOG")" "$N"
  fi
  if [ "$code" -ne 0 ]; then
    printf '  %s\n' "$(L "بعد از رفع مشکل، همین دستور را دوباره اجرا کنید." "Once it is fixed, run the same command again.")"
  fi
}

setup_io() {
  # Answers come from the terminal, even when the script itself arrives on
  # standard input (curl … | bash). With no terminal at all, they are read
  # from standard input instead, one per line.
  if (: < /dev/tty) 2> /dev/null; then exec 3< /dev/tty; else exec 3<&0; fi
  # The screen itself: the secrets are shown there, and never logged.
  exec 4>&1
  if [ -t 1 ]; then
    B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' C=$'\e[36m' N=$'\e[0m'
  fi
  touch "$LOG"
  chmod 600 "$LOG"
  printf '\n===== %s =====\n' "$(date -Is)" >> "$LOG"
  exec > >(tee -a "$LOG") 2>&1
}

# ================================================================= questions

unattended() { [ "${SK_ASSUME_YES:-0}" = 1 ]; }

CHECK_WHY='' NORMAL=''
fail() {
  CHECK_WHY=$1
  return 1
}

trim() {
  local v=$1
  v=${v#"${v%%[![:space:]]*}"}
  v=${v%"${v##*[![:space:]]}"}
  printf '%s' "$v"
}

# Persian and Arabic digits, as a Persian keyboard types them, made Latin.
digits() { printf '%s' "$1" | sed 'y/۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩/01234567890123456789/'; }

# accept VALUE CHECK: NORMAL is the value as it will be kept, CHECK_WHY what
# is wrong with it. A check function may rewrite NORMAL.
accept() {
  local value
  value=$(trim "$1")
  CHECK_WHY=''
  NORMAL=$value
  # .env keeps values in single quotes, where a single quote cannot go.
  case $value in *"'"*) fail "$(L "علامت ' در پاسخ‌ها پذیرفته نیست" "Answers may not contain the ' character")" || return 1 ;; esac
  [ -z "$2" ] || "$2" "$value"
}

# ask VAR "question" [default] [check] [hidden]
# A VAR set beforehand is used as it is, after the same check.
ask() {
  local var=$1 question=$2 default=${3:-} check=${4:-} hidden=${5:-} answer
  if [ -n "${!var+set}" ]; then
    if accept "${!var}" "$check"; then
      printf -v "$var" '%s' "$NORMAL"
      return 0
    fi
    unattended && die "$var: $CHECK_WHY"
    warn "$var: $CHECK_WHY"
  elif unattended; then
    accept "$default" "$check" || die "$(L "مقداری برای $var داده نشده است" "No value given for $var"): $CHECK_WHY"
    printf -v "$var" '%s' "$NORMAL"
    return 0
  fi
  while :; do
    printf '  %s?%s %s' "$B" "$N" "$question"
    [ -z "$default" ] || printf ' [%s]' "$default"
    printf ': '
    if [ "$hidden" = hidden ]; then
      IFS= read -r -s -u 3 answer || die "$(L "پاسخی نرسید" "No answer came")"
      if [ -t 3 ]; then printf '\n'; else printf '****\n'; fi
    else
      IFS= read -r -u 3 answer || die "$(L "پاسخی نرسید" "No answer came")"
      [ -t 3 ] || printf '%s\n' "$answer"
    fi
    [ -n "$(trim "$answer")" ] || answer=$default
    if accept "$answer" "$check"; then
      printf -v "$var" '%s' "$NORMAL"
      return 0
    fi
    warn "$CHECK_WHY"
  done
}

# yesno VAR "question" y|n: VAR becomes y or n.
yesno() { ask "$1" "$2 (y/n)" "$3" v_yesno; }

# choose VAR "question" default "name:label"…: VAR becomes the chosen name.
# The answer is its number (or, set beforehand, its name).
CHOICE_NAMES=()
choose() {
  local var=$1 question=$2 default=$3 option i=1 shown=1
  shift 3
  CHOICE_NAMES=()
  for option in "$@"; do CHOICE_NAMES+=("${option%%:*}"); done
  if [ -z "${!var+set}" ] && ! unattended; then
    printf '\n  %s?%s %s\n' "$B" "$N" "$question"
    for option in "$@"; do
      printf '     %s) %s\n' "$i" "${option#*:}"
      i=$((i + 1))
    done
    question=$(L "شماره" "Number")
  fi
  for i in "${!CHOICE_NAMES[@]}"; do
    [ "${CHOICE_NAMES[$i]}" != "$default" ] || shown=$((i + 1))
  done
  ask "$var" "$question" "$shown" v_choice
}
# The same, asked afresh every time (inside a loop).
menu() {
  unset "$1"
  choose "$@"
}

v_choice() {
  local v i
  v=$(digits "$1")
  for i in "${!CHOICE_NAMES[@]}"; do
    if [ "$v" = "$((i + 1))" ] || [ "$v" = "${CHOICE_NAMES[$i]}" ]; then
      NORMAL=${CHOICE_NAMES[$i]}
      return 0
    fi
  done
  fail "$(L "یکی از شماره‌های 1 تا ${#CHOICE_NAMES[@]}" "A number from 1 to ${#CHOICE_NAMES[@]}")"
}
v_yesno() {
  case ${1,,} in
    y | yes | ب | بله | آره | اره) NORMAL=y ;;
    n | no | ن | نه | خیر) NORMAL=n ;;
    *) fail "$(L "y یعنی بله، n یعنی نه" "y or n")" ;;
  esac
}
v_required() { [ -n "$1" ] || fail "$(L "این یکی لازم است" "This one is required")"; }
v_domain() {
  local d=${1,,}
  d=${d#http://}
  d=${d#https://}
  d=${d%%/*}
  d=${d%.}
  [[ $d =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$ ]] ||
    fail "$(L "یک دامنه مثل example.com (بدون https://)" "A domain like example.com (no https://)")" || return 1
  NORMAL=$d
}
v_domains() {
  local out='' d list
  read -r -a list <<< "${1//,/ }"
  for d in "${list[@]}"; do
    v_domain "$d" || return 1
    out="${out:+$out, }$NORMAL"
  done
  NORMAL=$out
}
v_email() {
  local e=${1,,}
  [[ $e =~ ^[^@[:space:]]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] ||
    fail "$(L "یک ایمیل مثل you@example.com" "An email like you@example.com")" || return 1
  NORMAL=$e
}
v_host() {
  local h=${1,,}
  [[ $h =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || fail "$(L "IP یا نام سرور" "The server's IP or name")" || return 1
  NORMAL=$h
}
v_port() {
  local p
  p=$(digits "$1")
  [[ $p =~ ^[0-9]{1,5}$ ]] && [ "$p" -ge 1 ] && [ "$p" -le 65535 ] ||
    fail "$(L "یک شماره‌ی پورت، مثل 587" "A port number, like 587")" || return 1
  NORMAL=$p
}
address_of() {
  local v=$1
  if [[ $v == *"<"*">"* ]]; then
    v=${v##*<}
    v=${v%%>*}
  fi
  printf '%s' "$v"
}
v_mail_from() {
  local address
  address=$(address_of "$1")
  [[ ${address,,} =~ ^[^@[:space:]]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] ||
    fail "$(L "مثل no-reply@example.com یا «شاه‌کلید <no-reply@example.com>»" "Like no-reply@example.com or \"Shah Kelid <no-reply@example.com>\"")"
}
v_uuid() {
  local u=${1,,}
  [[ $u =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
    fail "$(L "مرچنت کد ۳۶ نویسه است: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" "The merchant id has 36 characters: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")" || return 1
  NORMAL=$u
}
v_tron() {
  [ -z "$1" ] || [[ $1 =~ ^T[1-9A-HJ-NP-Za-km-z]{33}$ ]] ||
    fail "$(L "آدرس ترون با T شروع می‌شود و ۳۴ نویسه است" "A TRON address starts with T and has 34 characters")"
}
v_tg_token() {
  [ -z "$1" ] || [[ $1 =~ ^[0-9]{5,}:[A-Za-z0-9_-]{30,}$ ]] ||
    fail "$(L "توکن ربات شبیه 123456789:AAE… است (از BotFather)" "A bot token looks like 123456789:AAE… (from BotFather)")"
}
v_chat_ids() {
  local v
  v=$(digits "${1// /}")
  [[ $v =~ ^-?[0-9]+(,-?[0-9]+)*$ ]] || fail "$(L "شناسه‌های عددی، با کاما جدا" "Numeric ids, comma separated")" || return 1
  NORMAL=$v
}
v_url() {
  [ -z "$1" ] || [[ $1 =~ ^https?://[^[:space:]]+$ ]] || fail "$(L "یک نشانی کامل که با https:// شروع شود" "A full address starting with https://")" || return 1
  NORMAL=${1%/}
}
v_endpoint() { v_required "$1" && v_url "$1"; }
v_bucket() {
  [[ $1 =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](/[A-Za-z0-9._/-]+)?$ ]] ||
    fail "$(L "نام bucket: حروف کوچک انگلیسی، عدد و خط تیره" "A bucket name: lowercase letters, digits and dashes")"
}
v_key32() {
  [ "$(printf '%s' "$1" | base64 -d 2> /dev/null | wc -c)" = 32 ] ||
    fail "$(L "کلید ۴۴ نویسه‌ای که با = تمام می‌شود (همان APP_ENCRYPTION_KEY سرور قبلی)" "A 44-character key ending in = (the old server's APP_ENCRYPTION_KEY)")"
}
v_path() {
  [[ $1 =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "$(L "یک مسیر کامل، مثل /var/backups/shah-kelid" "A full path, like /var/backups/shah-kelid")" || return 1
  NORMAL=${1%/}
}
v_code() {
  local c
  c=$(digits "$1")
  [ -z "$c" ] || [[ $c =~ ^[0-9]{6}$ ]] || fail "$(L "کد ۶ رقمی ایمیل" "The 6-digit code from the email")" || return 1
  NORMAL=$c
}
v_repo() {
  v_required "$1" || return 1
  if ! GIT_TERMINAL_PROMPT=0 timeout 60 git ls-remote --heads "$1" "${SK_BRANCH:-main}" < /dev/null 2> /dev/null | grep -q .; then
    fail "$(L "این مخزن (یا شاخه‌ی ${SK_BRANCH:-main} در آن) خوانده نشد. مخزن خصوصی است؟ نشانی را با توکن بدهید: https://<توکن>@github.com/<کاربر>/<مخزن>.git" "This repository (or its ${SK_BRANCH:-main} branch) could not be read. Private? Give the address with a token: https://<token>@github.com/<user>/<repo>.git")"
  fi
}

# ================================================================== checks

public_ipv4() {
  local url ip
  for url in https://api.ipify.org https://ipv4.icanhazip.com https://ifconfig.me/ip; do
    ip=$(curl -4 -fsS -m 8 "$url" 2> /dev/null | tr -d '[:space:]') || true
    if [[ $ip =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
      printf '%s' "$ip"
      return 0
    fi
  done
  return 1
}
public_ipv6() { curl -6 -fsS -m 5 https://api64.ipify.org 2> /dev/null | tr -d '[:space:]' || true; }
ipv4_of() { getent ahostsv4 "$1" 2> /dev/null | awk '{print $1}' | sort -u | paste -sd' ' - || true; }
ipv6_of() { getent ahostsv6 "$1" 2> /dev/null | awk '$1 ~ /:/ && $1 !~ /^::ffff:/ {print $1}' | sort -u | paste -sd' ' - || true; }

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

# Where each address points. 0: all at this server; 1: one is missing or
# points elsewhere; 2: the only trouble is Cloudflare's proxy being on.
dns_report() {
  local host v4 v6 worst=0
  for host in "$@"; do
    v4=$(ipv4_of "$host")
    v6=$(ipv6_of "$host")
    if [ -z "$v4" ]; then
      warn "$host → $(L "هنوز رکورد A ندارد" "no A record yet")"
      worst=1
    elif [ "$v4" = "$SERVER_IP" ]; then
      ok "$host → $v4"
    elif is_cloudflare "${v4%% *}"; then
      warn "$host → $v4 ($(L "پروکسی Cloudflare روشن است" "Cloudflare's proxy is on"))"
      [ "$worst" -eq 1 ] || worst=2
    else
      warn "$host → $v4 $(L "(این سرور $SERVER_IP است)" "(this server is $SERVER_IP)")"
      worst=1
    fi
    # Let's Encrypt tries IPv6 first when there is an AAAA record.
    if [ -n "$v6" ] && [ -n "$v4" ] && ! is_cloudflare "${v4%% *}" && [ "$v6" != "$SERVER_IP6" ]; then
      warn "$host: $(L "رکورد AAAA به $v6 اشاره می‌کند که این سرور نیست. پاکش کنید یا درستش کنید." "an AAAA record points at $v6, which is not this server. Delete or correct it.")"
      worst=1
    fi
  done
  return "$worst"
}

verify_dns() {
  local code
  while :; do
    section "$(L "بررسی DNS" "Checking DNS")"
    code=0
    dns_report "${HOSTS[@]}" || code=$?
    [ "$code" -ne 0 ] || return 0
    if [ "$code" -eq 2 ]; then
      note "$(L "با پروکسی روشن، اگر «Always Use HTTPS» در Cloudflare روشن باشد گرفتن گواهی شکست می‌خورد." "With the proxy on, the certificate fails if Cloudflare's \"Always Use HTTPS\" is on.")"
      note "$(L "مطمئن‌ترین راه: تا پایان نصب، رکوردها را «DNS only» (ابر خاکستری) کنید و بعد دوباره نارنجی." "Safest: set the records to \"DNS only\" (grey cloud) until the install is done, then orange again.")"
    else
      note "$(L "در تنظیمات DNS دامنه، رکورد A را روی $SERVER_IP بگذارید. اعمال شدنش ممکن است چند دقیقه طول بکشد." "In the domain's DNS, point the A record at $SERVER_IP. It can take a few minutes to apply.")"
    fi
    if unattended; then
      warn "$(L "بدون DNS درست، گواهی HTTPS گرفته نمی‌شود. ادامه می‌دهم." "Without the right DNS no HTTPS certificate is issued. Going on.")"
      return 0
    fi
    menu DNS_NEXT "$(L "حالا چه کنم؟" "What now?")" again \
      "again:$(L "دوباره بررسی کن (DNS را درست کرده‌ام)" "Check again (I have fixed the DNS)")" \
      "go:$(L "همین‌طور ادامه بده" "Go on anyway")" \
      "change:$(L "دامنه را عوض می‌کنم" "I'll change the domain")"
    case $DNS_NEXT in
      again) sleep 3 ;;
      go) return 0 ;;
      change) return 1 ;;
    esac
  done
}

# Sends a code by mail, the way the app will send its sign-in codes:
# STARTTLS when the server offers it, or TLS from the start on port 465.
send_test_mail() {
  local to=$1 code=$2 from url config message name subject body
  local -a tls=(--ssl)
  from=$(address_of "$MAIL_FROM")
  if [ "$SMTP_PORT" = 465 ]; then
    url="smtps://$SMTP_HOST:465"
    tls=()
  else
    url="smtp://$SMTP_HOST:$SMTP_PORT"
  fi
  name=$(trim "${MAIL_FROM%%<*}")
  name=${name//\"/}
  subject=$(L "کد آزمایشی نصب شاه‌کلید: $code" "Shah Kelid install test code: $code")
  body=$(L "کد آزمایشی: $code

این ایمیل را برنامه‌ی نصب فرستاده تا مطمئن شود ایمیل‌های سایت می‌رسند. اگر در پوشه‌ی Spam بود، رکوردهای SPF و DKIM دامنه‌ی فرستنده را در سرویس ایمیل درست کنید." "Test code: $code

The installer sent this to make sure the site's mail arrives. If it landed in Spam, set up the sender domain's SPF and DKIM records with the mail service.")
  config=$(mktemp)
  message=$(mktemp)
  chmod 600 "$config"
  # The password goes through a file, not the command line, where any user
  # of the server could read it.
  printf 'user = "%s:%s"\n' "$(printf '%s' "$SMTP_USER" | sed 's/[\\"]/\\&/g')" "$(printf '%s' "$SMTP_PASSWORD" | sed 's/[\\"]/\\&/g')" > "$config"
  {
    if [ -n "$name" ] && [ "$name" != "$MAIL_FROM" ]; then
      printf 'From: =?UTF-8?B?%s?= <%s>\n' "$(printf '%s' "$name" | base64 -w0)" "$from"
    else
      printf 'From: <%s>\n' "$from"
    fi
    printf 'To: <%s>\n' "$to"
    printf 'Subject: =?UTF-8?B?%s?=\n' "$(printf '%s' "$subject" | base64 -w0)"
    printf 'Date: %s\n' "$(date -R)"
    printf 'Message-ID: <%s@%s>\n' "$(openssl rand -hex 12)" "${from#*@}"
    printf 'MIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n'
    printf '%s\n' "$body" | base64
  } > "$message"
  local code_out=0
  MAIL_ERROR=$(curl -sS -m 40 --url "$url" "${tls[@]}" -K "$config" --mail-from "$from" --mail-rcpt "$to" \
    --upload-file "$message" --crlf 2>&1 < /dev/null) || code_out=$?
  rm -f "$config" "$message"
  return "$code_out"
}

verify_mail() {
  local to=$1 code
  while :; do
    code=$(printf '%06d' $((0x$(openssl rand -hex 3) % 1000000)))
    section "$(L "آزمایش ایمیل" "Testing mail")"
    note "$(L "یک کد به $to می‌فرستم…" "Sending a code to $to…")"
    if send_test_mail "$to" "$code"; then
      ok "$(L "سرور ایمیل نامه را پذیرفت." "The mail server took the message.")"
      unattended && return 0
      while :; do
        unset MAIL_CODE
        ask MAIL_CODE "$(L "کدی که به ایمیلتان رسید (اگر نرسید، Enter)" "The code you received (Enter if none came)")" "" v_code
        if [ "$MAIL_CODE" = "$code" ]; then
          ok "$(L "ایمیل می‌رسد." "Mail arrives.")"
          return 0
        fi
        [ -n "$MAIL_CODE" ] && warn "$(L "این کد درست نیست." "That is not the code.")"
        [ -z "$MAIL_CODE" ] && warn "$(L "نامه پذیرفته شد ولی نرسید: پوشه‌ی Spam را ببینید، یا دامنه‌ی فرستنده در سرویس ایمیل تأیید نشده است." "The message was taken but did not arrive: check Spam, or the sender domain is not verified with the mail service.")"
        menu MAIL_NEXT "$(L "حالا چه کنم؟" "What now?")" retype \
          "retype:$(L "کد را دوباره وارد می‌کنم" "Let me type the code again")" \
          "resend:$(L "یک کد تازه بفرست" "Send a new code")" \
          "change:$(L "تنظیمات ایمیل را عوض می‌کنم" "I'll change the mail settings")" \
          "skip:$(L "بدون تأیید ادامه بده" "Go on without confirming")"
        case $MAIL_NEXT in
          retype) continue ;;
          resend) continue 2 ;;
          change) return 1 ;;
          skip) return 0 ;;
        esac
      done
    fi
    warn "$(L "نامه فرستاده نشد:" "The message could not be sent:") $(printf '%s' "$MAIL_ERROR" | tail -n 2 | tr '\n' ' ')"
    if unattended; then die "$(L "بدون ایمیل کسی نمی‌تواند وارد سایت شود. تنظیمات SMTP را درست کنید." "Without mail nobody can sign in. Fix the SMTP settings.")"; fi
    menu MAIL_NEXT "$(L "حالا چه کنم؟" "What now?")" change \
      "change:$(L "تنظیمات ایمیل را عوض می‌کنم" "I'll change the mail settings")" \
      "again:$(L "دوباره امتحان کن" "Try again")" \
      "skip:$(L "بدون آزمایش ادامه بده (کسی نمی‌تواند وارد شود تا ایمیل درست شود)" "Go on untested (nobody can sign in until mail works)")"
    case $MAIL_NEXT in
      change) return 1 ;;
      again) continue ;;
      skip) return 0 ;;
    esac
  done
}

telegram() { curl -fsS -m 15 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/$1" "${@:2}" < /dev/null 2> /dev/null; }

# ================================================================ questions

ask_language() {
  if [ -z "${SK_LANG+set}" ] && ! unattended; then
    printf '\n  %s\n     1) فارسی\n     2) English\n' "Language / زبان:"
  fi
  CHOICE_NAMES=(fa en)
  ask SK_LANG "1/2" 1 v_choice
  UI_LANG=$SK_LANG
}

preflight() {
  section "$(L "بررسی سرور" "Checking the server")"
  local os=unknown version='' mem disk ports
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    os=$(. /etc/os-release && printf '%s' "$ID")
    # shellcheck disable=SC1091
    version=$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")
  fi
  case $os in
    ubuntu | debian) ok "$os $version" ;;
    *)
      warn "$(L "این نصب روی Ubuntu آزموده شده است، نه $os." "This install was tested on Ubuntu, not $os.")"
      yesno SK_OTHER_OS "$(L "باز هم ادامه بدهم؟" "Go on anyway?")" n
      [ "$SK_OTHER_OS" = y ] || die "$(L "متوقف شد." "Stopped.")"
      ;;
  esac
  case $(uname -m) in
    x86_64 | aarch64) ok "$(uname -m)" ;;
    *) die "$(L "پردازنده‌ی $(uname -m) پشتیبانی نمی‌شود." "The $(uname -m) processor is not supported.")" ;;
  esac
  mem=$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
  if [ "$mem" -lt 1800 ]; then
    warn "$(L "رم: $mem مگابایت. دست‌کم ۲ گیگ لازم است و ۴ گیگ پیشنهاد می‌شود." "Memory: $mem MB. At least 2 GB is needed, 4 GB advised.")"
  else
    ok "$(L "رم: $mem مگابایت" "Memory: $mem MB")"
  fi
  disk=$(df -Pm / | awk 'NR == 2 {print $4}')
  if [ "$disk" -lt 10000 ]; then
    warn "$(L "فقط $((disk / 1024)) گیگ دیسک آزاد است؛ دست‌کم ۱۰ گیگ لازم است." "Only $((disk / 1024)) GB of disk free; at least 10 GB is needed.")"
    yesno SK_LOW_DISK "$(L "باز هم ادامه بدهم؟" "Go on anyway?")" n
    [ "$SK_LOW_DISK" = y ] || die "$(L "متوقف شد." "Stopped.")"
  else
    ok "$(L "دیسک آزاد: $((disk / 1024)) گیگ" "Free disk: $((disk / 1024)) GB")"
  fi
  # Caddy needs 80 (Let's Encrypt) and 443. Docker's own proxy is ours.
  ports=$(ss -Hltnp '( sport = :80 or sport = :443 )' 2> /dev/null | grep -v docker-proxy || true)
  if [ -n "$ports" ]; then
    printf '%s\n' "$ports"
    die "$(L "پورت ۸۰ یا ۴۴۳ دست برنامه‌ی دیگری است (بالا آمده). آن را متوقف کنید (مثلاً systemctl disable --now nginx) و دوباره اجرا کنید." "Port 80 or 443 is taken by another program (above). Stop it (systemctl disable --now nginx, say) and run again.")"
  fi
  ok "$(L "پورت‌های ۸۰ و ۴۴۳ آزادند" "Ports 80 and 443 are free")"

  local missing=()
  for tool in curl git openssl; do command -v "$tool" > /dev/null || missing+=("$tool"); done
  if [ "${#missing[@]}" -gt 0 ]; then
    note "$(L "نصب ابزارهای پایه: ${missing[*]}" "Installing the basic tools: ${missing[*]}")"
    quietly apt-get -o DPkg::Lock::Timeout=600 update -q
    quietly apt-get -o DPkg::Lock::Timeout=600 install -y -q curl git openssl ca-certificates
  fi
  curl -fsS -m 15 -o /dev/null https://get.docker.com ||
    die "$(L "این سرور به اینترنت (get.docker.com) وصل نمی‌شود." "This server cannot reach the internet (get.docker.com).")"
  ok "$(L "اینترنت" "Internet")"

  if [ -n "${SK_SERVER_IP:-}" ]; then
    SERVER_IP=$SK_SERVER_IP
  else
    SERVER_IP=$(public_ipv4) || {
      ask SK_SERVER_IP "$(L "IP عمومی این سرور پیدا نشد. IP را بنویسید" "The server's public IP could not be found. Type it")" "" v_host
      SERVER_IP=$SK_SERVER_IP
    }
  fi
  SERVER_IP6=$(public_ipv6)
  ok "$(L "IP سرور: $SERVER_IP" "Server IP: $SERVER_IP")"
}

find_existing() {
  # Run from inside a checkout: install right there.
  local here=''
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  fi
  if [ -z "${SK_REPO:-}" ] && [ -n "$here" ] && [ -x "$here/infra/production/sk" ]; then
    SK_DIR=$here
    CODE_FROM=checkout
  else
    SK_DIR=${SK_DIR:-/opt/shah-kelid}
    CODE_FROM=git
  fi
  PROD="$SK_DIR/infra/production"

  [ -f "$PROD/.env" ] || return 0
  section "$(L "شاه‌کلید از قبل روی این سرور نصب است ($SK_DIR)" "Shah Kelid is installed here already ($SK_DIR)")"
  choose SK_EXISTING "$(L "چه کنم؟" "What should I do?")" update \
    "update:$(L "به‌روزرسانی به آخرین نسخه و راه‌اندازی دوباره (تنظیمات و داده‌ها می‌مانند)" "Update to the latest release and restart (settings and data stay)")" \
    "quit:$(L "هیچ کاری نکن" "Nothing")"
  [ "$SK_EXISTING" = update ] || exit 0
  cd "$PROD"
  if [ -d "$SK_DIR/.git" ] && git -C "$SK_DIR" remote | grep -q .; then ./sk update; else ./sk up; fi
  ok "$(L "به‌روز شد. وضعیت: ./sk status در $PROD" "Updated. Status: ./sk status in $PROD")"
  exit 0
}

ask_code() {
  [ "$CODE_FROM" = git ] || {
    ok "$(L "کد: همین پوشه ($SK_DIR)" "Code: this folder ($SK_DIR)")"
    return 0
  }
  SK_BRANCH=${SK_BRANCH:-main}
  if [ -d "$SK_DIR/.git" ]; then
    ok "$(L "کد: $SK_DIR (از اجرای قبلی)" "Code: $SK_DIR (from an earlier run)")"
    return 0
  fi
  section "$(L "کد" "The code")"
  ask SK_REPO "$(L "نشانی مخزن git کد شاه‌کلید" "The git address of the Shah Kelid code")" "" v_repo
  ok "$(L "مخزن خوانده شد (شاخه‌ی $SK_BRANCH)" "Repository read (branch $SK_BRANCH)")"
}

ask_address() {
  section "$(L "نشانی سایت" "The site's address")"
  choose SK_ADDRESS "$(L "سایت روی چه نشانی‌ای باز شود؟" "Where will the site be opened?")" domain \
    "domain:$(L "روی دامنه‌ی خودم (برای فروش واقعی)" "On my own domain (for real sales)")" \
    "trial:$(L "فعلاً دامنه ندارم: نصب آزمایشی روی IP سرور (مرورگر هشدار امنیتی می‌دهد)" "No domain yet: a trial on the server's IP (browsers will warn)")"

  if [ "$SK_ADDRESS" = trial ]; then
    ask SK_TRIAL_HOST "$(L "نشانی‌ای که سایت با آن باز می‌شود" "The address to open the site at")" "$SERVER_IP" v_host
    MAIN_DOMAIN=$SK_TRIAL_HOST
    SITE_ADDRESSES=$SK_TRIAL_HOST
    [ "$SK_TRIAL_HOST" = localhost ] || SITE_ADDRESSES="$SK_TRIAL_HOST, localhost"
    CADDY_LOCAL_CERTS=local_certs
    SK_CLOUDFLARE=n
    return 0
  fi

  CADDY_LOCAL_CERTS=''
  while :; do
    ask MAIN_DOMAIN "$(L "دامنه‌ی اصلی (مثل shahkelid.com)" "The main domain (like shahkelid.com)")" "" v_domain
    HOSTS=("$MAIN_DOMAIN")
    if [[ $MAIN_DOMAIN != www.* ]]; then
      local www_default=n
      [ -z "$(ipv4_of "www.$MAIN_DOMAIN")" ] || www_default=y
      yesno SK_WWW "$(L "سایت روی www.$MAIN_DOMAIN هم باز شود؟ (رکورد A آن هم باید به این سرور اشاره کند)" "Open the site at www.$MAIN_DOMAIN too? (its A record must point here as well)")" "$www_default"
      [ "$SK_WWW" = n ] || HOSTS+=("www.$MAIN_DOMAIN")
    fi
    ask SK_BACKUP_DOMAINS "$(L "دامنه‌های پشتیبان، برای وقتی دامنه‌ی اصلی مسدود شد (اختیاری؛ با کاما جدا کنید)" "Backup domains, for when the main one is blocked (optional; comma separated)")" "" v_domains
    if [ -n "$SK_BACKUP_DOMAINS" ]; then
      local extra
      read -r -a extra <<< "${SK_BACKUP_DOMAINS//,/ }"
      HOSTS+=("${extra[@]}")
    fi
    yesno SK_CLOUDFLARE "$(L "دامنه پشت Cloudflare است؟" "Is the domain behind Cloudflare?")" n
    if verify_dns; then break; fi
    unset MAIN_DOMAIN SK_WWW SK_BACKUP_DOMAINS SK_CLOUDFLARE
  done
  SITE_ADDRESSES=$(printf '%s, ' "${HOSTS[@]}")
  SITE_ADDRESSES=${SITE_ADDRESSES%, }
}

ask_owner() {
  section "$(L "شما" "You")"
  if [ "$SK_MODE" = new ]; then
    ask SK_OWNER_EMAIL "$(L "ایمیل مالک فروشگاه (با همین وارد بخش مدیریت می‌شوید)" "The shop owner's email (you sign in to the staff area with it)")" "" v_email
  else
    ask SK_OWNER_EMAIL "$(L "ایمیل شما (برای اعلان‌های گواهی HTTPS و نامه‌ی آزمایشی)" "Your email (for HTTPS certificate notices and the test message)")" "" v_email
  fi
  ACME_EMAIL=${ACME_EMAIL:-$SK_OWNER_EMAIL}
}

ask_mail() {
  section "$(L "ایمیل سایت (SMTP)" "The site's mail (SMTP)")"
  note "$(L "کد ورود با ایمیل می‌رود؛ بدون آن هیچ‌کس، حتی شما، نمی‌تواند وارد شود." "Sign-in codes go by email; without it nobody, not even you, can sign in.")"
  note "$(L "از سرویس ایمیلتان (Brevo، Mailgun، Amazon SES…) این‌ها را بردارید:" "Take these from your mail service (Brevo, Mailgun, Amazon SES…):")"
  local from_default=''
  while :; do
    ask SMTP_HOST "$(L "سرور SMTP (مثل smtp-relay.brevo.com)" "SMTP server (like smtp-relay.brevo.com)")" "" v_host
    ask SMTP_PORT "$(L "پورت" "Port")" 587 v_port
    ask SMTP_USER "$(L "نام کاربری SMTP" "SMTP user name")" "" v_required
    ask SMTP_PASSWORD "$(L "رمز SMTP (دیده نمی‌شود)" "SMTP password (not shown)")" "" v_required hidden
    if [ "$SK_ADDRESS" = domain ]; then
      from_default="شاه‌کلید <no-reply@$MAIN_DOMAIN>"
      [ "$UI_LANG" = fa ] || from_default="Shah Kelid <no-reply@$MAIN_DOMAIN>"
    elif [[ $SMTP_USER == *@* ]]; then
      from_default=$SMTP_USER
    fi
    ask MAIL_FROM "$(L "فرستنده‌ی ایمیل‌ها (دامنه‌اش باید در سرویس ایمیل تأیید شده باشد)" "The sender (its domain must be verified with the mail service)")" "$from_default" v_mail_from
    if verify_mail "$SK_OWNER_EMAIL"; then break; fi
    unset SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD MAIL_FROM
  done
}

ask_payments() {
  section "$(L "پرداخت" "Payments")"
  if [ "$SK_ADDRESS" = trial ]; then
    note "$(L "در نصب آزمایشی، زرین‌پال در حالت sandbox است (پرداخت واقعی نیست)، مگر مرچنت کد بدهید." "On a trial install Zarinpal runs in its sandbox (no real payments) unless you give a merchant id.")"
    ask ZARINPAL_MERCHANT_ID "$(L "مرچنت کد زرین‌پال (اختیاری)" "Zarinpal merchant id (optional)")" "" v_uuid_or_empty
    if [ -z "$ZARINPAL_MERCHANT_ID" ]; then
      ZARINPAL_MERCHANT_ID=00000000-0000-0000-0000-000000000000
      ZARINPAL_SANDBOX=true
    fi
  else
    ask ZARINPAL_MERCHANT_ID "$(L "مرچنت کد زرین‌پال (از پنل زرین‌پال)" "Zarinpal merchant id (from the Zarinpal panel)")" "" v_uuid
  fi
  ZARINPAL_SANDBOX=${ZARINPAL_SANDBOX:-false}

  note "$(L "تتر روی ترون (اختیاری): فقط آدرس دریافت. هرگز کلید خصوصی یا عبارت بازیابی را جایی وارد نکنید." "USDT on TRON (optional): the receiving address only. Never type a private key or recovery phrase anywhere.")"
  ask TRON_RECEIVE_ADDRESS "$(L "آدرس تتر (TRC20)، یا Enter برای رد شدن" "USDT (TRC20) address, or Enter to skip")" "" v_tron
  if [ -n "$TRON_RECEIVE_ADDRESS" ]; then
    ask TRONGRID_API_KEY "$(L "کلید TronGrid (اختیاری، از trongrid.io؛ بدون آن محدودیت درخواست دارد)" "TronGrid API key (optional, from trongrid.io; rate limited without one)")" ""
  fi
  ask NOWPAYMENTS_API_KEY "$(L "کلید API درگاه NOWPayments، یا Enter برای رد شدن" "NOWPayments API key, or Enter to skip")" ""
  if [ -n "$NOWPAYMENTS_API_KEY" ]; then
    ask NOWPAYMENTS_IPN_SECRET "$(L "IPN secret همان حساب NOWPayments (دیده نمی‌شود)" "That NOWPayments account's IPN secret (not shown)")" "" v_required hidden
  fi
}
v_uuid_or_empty() { [ -z "$1" ] || v_uuid "$1"; }

ask_telegram() {
  section "$(L "هشدار در تلگرام (اختیاری)" "Alerts on Telegram (optional)")"
  note "$(L "هشدارها همیشه به ایمیل مدیرها می‌روند؛ با ربات، در تلگرام هم می‌رسند. ربات را با @BotFather بسازید." "Alerts always go to admins by email; with a bot, on Telegram too. Make one with @BotFather.")"
  local name chats
  while :; do
    ask TELEGRAM_BOT_TOKEN "$(L "توکن ربات، یا Enter برای رد شدن" "Bot token, or Enter to skip")" "" v_tg_token hidden
    [ -n "$TELEGRAM_BOT_TOKEN" ] || return 0
    name=$(telegram getMe | grep -o '"username":"[^"]*"' | cut -d'"' -f4 || true)
    if [ -n "$name" ]; then
      ok "$(L "ربات: @$name" "Bot: @$name")"
      break
    fi
    unattended && die "$(L "تلگرام این توکن را نپذیرفت." "Telegram did not accept this token.")"
    warn "$(L "تلگرام این توکن را نپذیرفت." "Telegram did not accept this token.")"
    unset TELEGRAM_BOT_TOKEN
  done

  if [ -z "${TELEGRAM_ADMIN_CHAT_IDS+set}" ] && ! unattended; then
    note "$(L "از تلگرام هر مدیر یک پیام به @$name بفرستید (برای گروه: ربات را عضو کنید و در گروه پیام بدهید). بعد Enter بزنید." "From each admin's Telegram, send @$name a message (for a group: add the bot and post there). Then press Enter.")"
    IFS= read -r -u 3 _ || true
    chats=$(telegram getUpdates | grep -oE '"chat":\{"id":-?[0-9]+' | grep -oE -- '-?[0-9]+$' | sort -u | paste -sd, - || true)
    if [ -n "$chats" ]; then ok "$(L "گفتگوهای پیدا شده: $chats" "Chats found: $chats")"; else warn "$(L "پیامی پیدا نشد؛ شناسه را دستی بنویسید (مثلاً از @userinfobot)." "No message found; type the id yourself (from @userinfobot, say).")"; fi
  fi
  ask TELEGRAM_ADMIN_CHAT_IDS "$(L "شناسه‌ی گفتگوهایی که هشدار بگیرند (با کاما)" "Chat ids to alert (comma separated)")" "${chats:-}" v_chat_ids
  local id sent=0
  for id in ${TELEGRAM_ADMIN_CHAT_IDS//,/ }; do
    if telegram sendMessage -d chat_id="$id" --data-urlencode text="$(L "✅ هشدارهای شاه‌کلید به این گفتگو می‌آیند." "✅ Shah Kelid alerts will come to this chat.")" > /dev/null; then
      sent=$((sent + 1))
    else
      warn "$(L "به گفتگوی $id پیام نرفت (ربات را آن‌جا start کرده‌اید؟)" "Could not message chat $id (has it started the bot?)")"
    fi
  done
  [ "$sent" -eq 0 ] || ok "$(L "پیام آزمایشی به $sent گفتگو رفت." "A test message went to $sent chat(s).")"
}

ask_backups() {
  section "$(L "پشتیبان‌ها" "Backups")"
  local default=s3
  [ "$SK_ADDRESS" = domain ] || default=local
  while :; do
    if [ "$SK_MODE" = restore ]; then
      choose SK_BACKUP "$(L "پشتیبان‌های سرور قبلی کجاست؟" "Where are the old server's backups?")" s3 \
        "s3:$(L "در فضای ابری S3 (همان bucket سرور قبلی)" "In S3 storage (the old server's bucket)")" \
        "local:$(L "در پوشه‌ای روی همین سرور (آن را از سرور قبلی کپی کرده‌ام)" "In a folder on this server (copied over from the old one)")"
    else
      choose SK_BACKUP "$(L "پشتیبان‌ها کجا نگه داشته شوند؟ (هر ۶ ساعت، رمزگذاری‌شده)" "Where should backups go? (every 6 hours, encrypted)")" "$default" \
        "s3:$(L "فضای ابری سازگار با S3، مثل Backblaze B2 یا Cloudflare R2 (پیشنهادی)" "S3-compatible storage, like Backblaze B2 or Cloudflare R2 (advised)")" \
        "local:$(L "فعلاً روی همین سرور (اگر سرور از دست برود، پشتیبان‌ها هم می‌روند)" "On this server for now (lost along with the server)")"
    fi
    if [ "$SK_BACKUP" = local ]; then
      ask BACKUP_LOCAL_DIR "$(L "پوشه‌ی پشتیبان‌ها روی سرور" "The backups folder on this server")" /var/backups/shah-kelid v_path
      RESTIC_REPOSITORY=/backups/restic
      if [ "$SK_MODE" = restore ] && [ ! -f "$BACKUP_LOCAL_DIR/restic/config" ]; then
        warn "$(L "در $BACKUP_LOCAL_DIR/restic پشتیبانی نیست. پوشه‌ی پشتیبان سرور قبلی را آن‌جا کپی کنید." "There is no backup in $BACKUP_LOCAL_DIR/restic. Copy the old server's backups folder there.")"
        unattended && die "$(L "پشتیبانی برای بازیابی نیست." "No backup to restore from.")"
        unset SK_BACKUP BACKUP_LOCAL_DIR
        continue
      fi
      return 0
    fi

    note "$(L "یک bucket خالی بسازید و کلیدی که فقط به همان bucket دسترسی دارد. نشانی endpoint نمونه:" "Make an empty bucket, and a key that reaches only that bucket. Endpoint examples:")"
    note "Backblaze B2:   https://s3.us-west-004.backblazeb2.com"
    note "Cloudflare R2:  https://<account-id>.r2.cloudflarestorage.com"
    ask SK_S3_ENDPOINT "$(L "نشانی endpoint" "Endpoint address")" "" v_endpoint
    ask SK_S3_BUCKET "$(L "نام bucket" "Bucket name")" "" v_bucket
    ask BACKUP_S3_ACCESS_KEY_ID "$(L "Key ID" "Key ID")" "" v_required
    ask BACKUP_S3_SECRET_ACCESS_KEY "$(L "Secret key (دیده نمی‌شود)" "Secret key (not shown)")" "" v_required hidden
    ask BACKUP_S3_REGION "$(L "Region (برای B2 و R2 همان auto؛ برای AWS مثلاً us-east-1)" "Region (auto for B2 and R2; for AWS e.g. us-east-1)")" auto v_required
    RESTIC_REPOSITORY="s3:$SK_S3_ENDPOINT/$SK_S3_BUCKET"
    if [ "$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$SK_S3_ENDPOINT" < /dev/null || true)" != 000 ]; then
      ok "$(L "فضای ابری در دسترس است (کلیدها بعد از نصب با اولین پشتیبان آزموده می‌شوند)." "The storage answers (the keys are tested by the first backup, after the install).")"
      return 0
    fi
    warn "$(L "به $SK_S3_ENDPOINT وصل نشدم." "Could not reach $SK_S3_ENDPOINT.")"
    unattended && die "$(L "فضای ابری در دسترس نیست." "The storage cannot be reached.")"
    unset SK_BACKUP SK_S3_ENDPOINT SK_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_S3_REGION
  done
}

ask_restore_secrets() {
  section "$(L "دو رمزی که از سرور قبلی نگه داشته‌اید" "The two secrets kept from the old server")"
  note "$(L "همان‌هایی که نصب قبلی گفت بیرون از سرور نگه دارید." "The ones the earlier install told you to keep away from the server.")"
  ask SK_OLD_RESTIC_PASSWORD "$(L "RESTIC_PASSWORD (دیده نمی‌شود)" "RESTIC_PASSWORD (not shown)")" "" v_required hidden
  ask SK_OLD_APP_ENCRYPTION_KEY "$(L "APP_ENCRYPTION_KEY (دیده نمی‌شود)" "APP_ENCRYPTION_KEY (not shown)")" "" v_key32 hidden
}

ask_extras() {
  ask BACKUP_PING_URL "$(L "نشانی پایش پشتیبان مثل healthchecks.io (اختیاری)" "A backup monitor address, like healthchecks.io (optional)")" "" v_url
  SK_FIREWALL=${SK_FIREWALL:-y}
}

summary() {
  section "$(L "خلاصه" "Summary")"
  local mode backups
  mode=$(L "نصب تازه" "New install")
  [ "$SK_MODE" = new ] || mode=$(L "بازیابی از پشتیبان" "Restore from a backup")
  backups="$RESTIC_REPOSITORY"
  [ "$SK_BACKUP" = s3 ] || backups="$BACKUP_LOCAL_DIR $(L "(روی همین سرور)" "(on this server)")"
  # Label, then value: padding cannot line Persian up in a terminal anyway.
  row() { printf '    %s%s:%s %s\n' "$B" "$1" "$N" "$2"; }
  row "$(L "کار" "What")" "$mode"
  row "$(L "کد" "Code")" "${SK_REPO:-$SK_DIR}"
  row "$(L "نشانی‌ها" "Addresses")" "$SITE_ADDRESSES"
  [ "$SK_CLOUDFLARE" = n ] || row Cloudflare "$(L "بله" "yes")"
  row "$(L "مالک" "Owner")" "$SK_OWNER_EMAIL"
  row SMTP "$SMTP_USER @ $SMTP_HOST:$SMTP_PORT"
  row "$(L "فرستنده" "Sender")" "$MAIL_FROM"
  row "$(L "زرین‌پال" "Zarinpal")" "$ZARINPAL_MERCHANT_ID$([ "$ZARINPAL_SANDBOX" = false ] || printf ' (sandbox)')"
  [ -z "$TRON_RECEIVE_ADDRESS" ] || row "USDT (TRC20)" "$TRON_RECEIVE_ADDRESS"
  [ -z "$NOWPAYMENTS_API_KEY" ] || row NOWPayments "$(L "بله" "yes")"
  [ -z "$TELEGRAM_BOT_TOKEN" ] || row Telegram "$TELEGRAM_ADMIN_CHAT_IDS"
  row "$(L "پشتیبان‌ها" "Backups")" "$backups"
  [ "$SK_FIREWALL" = n ] || row "$(L "دیوار آتش" "Firewall")" "SSH, 80, 443"
  printf '\n'
  note "$(L "حالا سرور به‌روز می‌شود، Docker نصب می‌شود و ایمیج‌ها ساخته می‌شوند: حدود ۱۰ دقیقه، بدون سؤال دیگر." "Now the server is updated, Docker installed and the images built: about 10 minutes, with no more questions.")"
  yesno SK_GO "$(L "شروع کنم؟" "Start?")" y
  [ "$SK_GO" = y ] || die "$(L "چیزی تغییر نکرد." "Nothing was changed.")"
}

# ==================================================================== install

install_system() {
  step "$(L "به‌روزرسانی سیستم" "Updating the system")"
  local apt=(apt-get -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -y -q)
  quietly "${apt[@]}" update
  quietly "${apt[@]}" upgrade
  quietly "${apt[@]}" install git curl openssl ca-certificates ufw
  ok "$(L "به‌روز شد" "Up to date")"

  # Building the images needs more memory than running them.
  local mem
  mem=$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)
  if [ "$mem" -lt 3500 ] && [ -z "$(swapon --show --noheadings 2> /dev/null)" ]; then
    if { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile; } > /dev/null 2>&1; then
      grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      ok "$(L "۲ گیگ swap ساخته شد (رم کم است)" "Made 2 GB of swap (memory is low)")"
    else
      rm -f /swapfile
      warn "$(L "swap ساخته نشد؛ ساختن ایمیج‌ها ممکن است کند باشد." "Could not make swap; building the images may be slow.")"
    fi
  fi
}

install_firewall() {
  [ "$SK_FIREWALL" = y ] || return 0
  step "$(L "دیوار آتش" "Firewall")"
  # Every port SSH may be on, asked four ways: the firewall must never lock
  # out the person running it. (Since Ubuntu 22.10 systemd, not sshd, holds
  # the listening socket, so the open sessions and sshd's own settings count.)
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
    ok "$(L "فقط SSH، ۸۰ و ۴۴۳ باز است" "Only SSH, 80 and 443 are open")"
  else
    warn "$(L "دیوار آتش روشن نشد (روی این سرور ufw کار نمی‌کند). از دیوار آتش سرویس‌دهنده استفاده کنید." "The firewall could not be turned on (ufw does not work on this server). Use your provider's firewall.")"
  fi
}

install_docker() {
  step "Docker"
  if docker compose version > /dev/null 2>&1; then
    ok "$(docker compose version)"
    return 0
  fi
  local script
  script=$(mktemp)
  if ! { curl -fsSL -o "$script" https://get.docker.com && quietly sh "$script"; }; then
    warn "$(L "get.docker.com کار نکرد؛ Docker از مخزن Ubuntu نصب می‌شود." "get.docker.com failed; installing Docker from Ubuntu's own repository.")"
    quietly apt-get -o DPkg::Lock::Timeout=600 install -y -q docker.io docker-compose-v2
  fi
  rm -f "$script"
  systemctl enable --now docker > /dev/null 2>&1 || true
  docker compose version > /dev/null 2>&1 || die "$(L "Docker نصب نشد." "Docker could not be installed.")"
  ok "$(docker compose version)"
}

install_code() {
  step "$(L "کد" "The code")"
  if [ "$CODE_FROM" = checkout ]; then
    ok "$SK_DIR"
  elif [ -d "$SK_DIR/.git" ]; then
    git -C "$SK_DIR" pull --ff-only -q < /dev/null || warn "$(L "به‌روزرسانی کد نشد؛ با همان نسخه ادامه می‌دهم." "Could not update the code; going on with this version.")"
    ok "$SK_DIR"
  else
    GIT_TERMINAL_PROMPT=0 git clone -q --branch "$SK_BRANCH" "$SK_REPO" "$SK_DIR" < /dev/null
    ok "$SK_DIR"
  fi
  # The repository address may carry a token: only root reads this folder.
  chmod 750 "$SK_DIR"
  chmod +x "$PROD/sk"
}

# quietly COMMAND…: its output is shown only when it fails.
quietly() {
  local out
  if ! out=$("$@" < /dev/null 2>&1); then
    printf '%s\n' "$out" | tail -n 25
    return 1
  fi
}

# set_env KEY VALUE: one line of .env, replaced in place (its mode stays 600).
set_env() {
  local line="$1=$2"
  # Anything beyond plain characters goes in single quotes, where compose
  # reads it literally ($ and # included).
  [[ $2 =~ ^[A-Za-z0-9_./:@,+=%-]*$ ]] || line="$1='$2'"
  KEY=$1 LINE=$line awk '
    BEGIN { key = ENVIRON["KEY"] "="; line = ENVIRON["LINE"] }
    index($0, key) == 1 { print line; done = 1; next }
    { print }
    END { if (!done) print line }
  ' .env > .env.next
  cat .env.next > .env
  rm -f .env.next
}

configure() {
  step "$(L "تنظیمات (.env)" "Settings (.env)")"
  cd "$PROD"
  ./sk init < /dev/null > /dev/null
  set_env MAIN_DOMAIN "$MAIN_DOMAIN"
  set_env SITE_ADDRESSES "$SITE_ADDRESSES"
  set_env ACME_EMAIL "$ACME_EMAIL"
  set_env CADDY_LOCAL_CERTS "$CADDY_LOCAL_CERTS"
  if [ "$SK_CLOUDFLARE" = y ]; then
    local ranges
    ranges=$(curl -fsS -m 15 https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6 | tr '\n' ' ' || true)
    if [ -n "$(trim "$ranges")" ]; then
      set_env TRUSTED_PROXIES "$(trim "$ranges")"
      ok "$(L "نشانی‌های Cloudflare مورد اعتمادند" "Cloudflare's ranges are trusted")"
    else
      warn "$(L "فهرست نشانی‌های Cloudflare گرفته نشد؛ بعداً بخش ۱۱ راهنمای نصب را انجام دهید." "Could not fetch Cloudflare's ranges; do section 11 of the install guide later.")"
    fi
  fi
  set_env SMTP_HOST "$SMTP_HOST"
  set_env SMTP_PORT "$SMTP_PORT"
  set_env SMTP_USER "$SMTP_USER"
  set_env SMTP_PASSWORD "$SMTP_PASSWORD"
  set_env MAIL_FROM "$MAIL_FROM"
  set_env ZARINPAL_SANDBOX "$ZARINPAL_SANDBOX"
  set_env ZARINPAL_MERCHANT_ID "$ZARINPAL_MERCHANT_ID"
  set_env TRON_RECEIVE_ADDRESS "$TRON_RECEIVE_ADDRESS"
  set_env TRONGRID_API_KEY "${TRONGRID_API_KEY:-}"
  set_env NOWPAYMENTS_API_KEY "$NOWPAYMENTS_API_KEY"
  set_env NOWPAYMENTS_IPN_SECRET "${NOWPAYMENTS_IPN_SECRET:-}"
  set_env TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
  set_env TELEGRAM_ADMIN_CHAT_IDS "${TELEGRAM_ADMIN_CHAT_IDS:-}"
  set_env RESTIC_REPOSITORY "$RESTIC_REPOSITORY"
  set_env BACKUP_S3_ACCESS_KEY_ID "${BACKUP_S3_ACCESS_KEY_ID:-}"
  set_env BACKUP_S3_SECRET_ACCESS_KEY "${BACKUP_S3_SECRET_ACCESS_KEY:-}"
  set_env BACKUP_S3_REGION "${BACKUP_S3_REGION:-auto}"
  set_env BACKUP_LOCAL_DIR "${BACKUP_LOCAL_DIR:-/var/backups/shah-kelid}"
  set_env BACKUP_PING_URL "$BACKUP_PING_URL"
  if [ "$SK_MODE" = restore ]; then
    set_env RESTIC_PASSWORD "$SK_OLD_RESTIC_PASSWORD"
    set_env APP_ENCRYPTION_KEY "$SK_OLD_APP_ENCRYPTION_KEY"
  fi
  if [ "$SK_BACKUP" = local ]; then
    mkdir -p "$BACKUP_LOCAL_DIR"
    chmod 700 "$BACKUP_LOCAL_DIR"
  fi
  ok "$PROD/.env"
}

env_value() { grep -E "^$1=" "$PROD/.env" | head -n 1 | cut -d= -f2- | sed "s/^'//; s/'\$//"; }

start() {
  step "$(L "ساختن ایمیج‌ها و راه‌اندازی (بار اول چند دقیقه)" "Building the images and starting (a few minutes the first time)")"
  if ! ./sk up < /dev/null; then
    ./sk status < /dev/null || true
    docker compose --env-file .env -f compose.yaml logs --tail 30 app migrate < /dev/null || true
    die "$(L "راه‌اندازی کامل نشد (جزئیات بالا). بخش «اگر کار نکرد» در docs/05-install.md را ببینید." "Starting did not finish (details above). See \"If it does not work\" in docs/05-install.md.")"
  fi
  ok "$(L "همه‌ی سرویس‌ها بالا هستند" "Every service is up")"
}

restore_backup() {
  step "$(L "بازیابی از پشتیبان" "Restoring from the backup")"
  local list
  list=$(./sk snapshots < /dev/null) || die "$(L "پشتیبان‌ها خوانده نشدند. RESTIC_PASSWORD، نشانی bucket و کلیدها را بررسی کنید: ./sk logs backup" "The backups could not be read. Check RESTIC_PASSWORD, the bucket and its keys: ./sk logs backup")"
  printf '%s\n' "$list"
  grep -q 'accounts-' <<< "$list" || die "$(L "در این مخزن پشتیبانی از فروشگاه نیست." "This repository holds no backup of a shop.")"
  ask SK_SNAPSHOT "$(L "کدام پشتیبان؟ (latest یعنی آخرین؛ یا شناسه‌ی ستون اول)" "Which backup? (latest is the newest; or an id from the first column)")" latest v_required
  if ! unattended; then
    yesno SK_RESTORE_GO "$(L "دیتابیس و فایل‌های این سرور با پشتیبان «$SK_SNAPSHOT» جایگزین شوند؟" "Replace this server's database and files with backup \"$SK_SNAPSHOT\"?")" y
    [ "$SK_RESTORE_GO" = y ] || die "$(L "بازیابی انجام نشد. بعداً: ./sk restore latest" "Not restored. Later: ./sk restore latest")"
  fi
  ./sk restore "$SK_SNAPSHOT" --yes < /dev/null
  ok "$(L "بازیابی شد" "Restored")"
}

make_owner() {
  step "$(L "حساب مالک" "The owner's account")"
  local out
  if out=$(./sk create-owner "$SK_OWNER_EMAIL" < /dev/null 2>&1); then
    ok "$SK_OWNER_EMAIL"
  elif grep -q "already exists" <<< "$out"; then
    ok "$(L "مالک از قبل هست" "There is an owner already")"
  else
    printf '%s\n' "$out"
    die "$(L "حساب مالک ساخته نشد." "Could not make the owner's account.")"
  fi
}

first_backup() {
  step "$(L "اولین پشتیبان" "The first backup")"
  if ./sk backup < /dev/null > /dev/null 2>&1; then
    BACKUP_OK=1
    ok "$(L "پشتیبان گرفته و خوانده شد" "Backed up, and read back")"
  else
    BACKUP_OK=0
    warn "$(L "پشتیبان‌گیری شکست خورد. معمولاً کلیدها یا نام bucket اشتباه است. جزئیات: ./sk logs backup" "The backup failed. Usually the keys or the bucket name are wrong. Details: ./sk logs backup")"
    note "$(L "بعد از درست کردن .env: ./sk up و بعد ./sk backup" "After fixing .env: ./sk up, then ./sk backup")"
  fi
}

check_site() {
  step "$(L "بررسی سایت" "Checking the site")"
  local url args i
  if [ "$SK_ADDRESS" = trial ]; then
    url=https://localhost/health
    args=(-k)
  else
    url="https://$MAIN_DOMAIN/health"
    # Asked of this server itself, with a real certificate check.
    args=(--resolve "$MAIN_DOMAIN:443:127.0.0.1")
  fi
  for i in $(seq 1 30); do
    if curl -fsS -m 10 "${args[@]}" -o /dev/null "$url" < /dev/null 2> /dev/null; then
      SITE_OK=1
      ok "$(L "سایت با HTTPS جواب می‌دهد" "The site answers over HTTPS")"
      return 0
    fi
    sleep 4
  done
  SITE_OK=0
  warn "$(L "سایت هنوز با گواهی معتبر جواب نمی‌دهد؛ معمولاً DNS هنوز به این سرور نرسیده. Caddy خودش دوباره تلاش می‌کند. جزئیات: ./sk logs web" "The site does not answer with a valid certificate yet; usually the DNS has not reached this server. Caddy keeps trying by itself. Details: ./sk logs web")"
}

report() {
  local site="https://$MAIN_DOMAIN" restic_password key minutes
  restic_password=$(env_value RESTIC_PASSWORD)
  key=$(env_value APP_ENCRYPTION_KEY)
  minutes=$((($(date +%s) - STARTED + 59) / 60))
  umask 077
  {
    printf '%s\n' "$(L "شاه‌کلید نصب شد" "Shah Kelid is installed") — $(date '+%Y-%m-%d %H:%M')"
    printf '\n%s\n' "$(L "سایت" "Site"): $site"
    printf '%s\n' "$(L "بخش مدیریت" "Staff area"): $site/staff"
    printf '%s\n' "$(L "پوشه" "Folder"): $PROD"
    printf '\n%s\n' "$(L "ورود مالک" "Owner's sign-in"):"
    if [ "$SK_MODE" = new ]; then
      printf '  %s\n' "$(L "1. $site/account/sign-in را باز کنید و $SK_OWNER_EMAIL را بزنید." "1. Open $site/account/sign-in and type $SK_OWNER_EMAIL.")"
      printf '  %s\n' "$(L "2. کدی را که به ایمیل می‌رسد وارد کنید." "2. Type the code that arrives by email.")"
      printf '  %s\n' "$(L "3. ورود دومرحله‌ای را با Google Authenticator یا 2FAS راه بیندازید و کدهای پشتیبان را نگه دارید." "3. Set up two-step sign-in with Google Authenticator or 2FAS, and keep the backup codes.")"
    else
      printf '  %s\n' "$(L "همان حساب‌های سرور قبلی، با همان برنامه‌ی Authenticator." "The old server's accounts, with the same authenticator app.")"
    fi
    printf '\n%s\n' "$(L "این دو را بیرون از این سرور نگه دارید (مثلاً در مدیر رمز). بدون آن‌ها پشتیبان‌ها خوانده نمی‌شوند و ورود دومرحله‌ای بعد از بازیابی کار نمی‌کند:" "Keep these two away from this server (in a password manager, say). Without them the backups cannot be read, and two-step sign-in does not survive a restore:")"
    printf '  RESTIC_PASSWORD=%s\n' "$restic_password"
    printf '  APP_ENCRYPTION_KEY=%s\n' "$key"
    printf '\n%s\n' "$(L "بعد از نصب" "Next"):"
    [ "$SK_ADDRESS" = domain ] || printf '  - %s\n' "$(L "این نصب آزمایشی است (گواهی خودامضا). برای فروش واقعی با یک دامنه دوباره نصب کنید." "This is a trial (self-signed certificate). Install again with a domain for real sales.")"
    [ "$SK_CLOUDFLARE" = n ] || printf '  - %s\n' "$(L "در Cloudflare رکوردها را Proxied (ابر نارنجی) و SSL/TLS را Full (strict) کنید." "In Cloudflare, set the records to Proxied (orange cloud) and SSL/TLS to Full (strict).")"
    [ "$SK_BACKUP" = s3 ] || printf '  - %s\n' "$(L "پشتیبان‌ها فقط روی همین سرورند ($BACKUP_LOCAL_DIR). به‌زودی یک bucket بسازید یا آن پوشه را مرتب جای دیگری کپی کنید." "Backups are only on this server ($BACKUP_LOCAL_DIR). Set up a bucket soon, or copy that folder elsewhere regularly.")"
    [ "${BACKUP_OK:-1}" = 1 ] || printf '  - %s\n' "$(L "اولین پشتیبان شکست خورد: ./sk logs backup" "The first backup failed: ./sk logs backup")"
    [ "${SITE_OK:-1}" = 1 ] || printf '  - %s\n' "$(L "سایت هنوز با HTTPS جواب نداد: ./sk logs web" "The site did not answer over HTTPS yet: ./sk logs web")"
    [ ! -f /var/run/reboot-required ] || printf '  - %s\n' "$(L "سیستم به‌روزرسانی‌ای دارد که راه‌اندازی دوباره می‌خواهد: reboot (سایت خودش دوباره بالا می‌آید)." "A system update wants a restart: reboot (the site comes back up by itself).")"
    if [ "$SK_MODE" = new ]; then
      printf '  - %s\n' "$(L "در $site/staff: پنل PasarGuard، سرورها، پلن‌ها و کارت‌ها را اضافه کنید و یک خرید آزمایشی انجام دهید (docs/05-install.md بخش ۸)." "In $site/staff: add the PasarGuard panel, servers, plans and cards, then make a test purchase (docs/05-install.md section 8).")"
    else
      printf '  - %s\n' "$(L "DNS دامنه‌ها را به IP این سرور ($SERVER_IP) تغییر دهید." "Point the domains' DNS at this server ($SERVER_IP).")"
    fi
    printf '\n%s\n' "$(L "دستورها (در $PROD):" "Commands (in $PROD):")"
    printf '  ./sk status | ./sk logs app | ./sk backup | ./sk snapshots | ./sk update\n'
    printf '\n%s\n' "$(L "گزارش کامل نصب: $LOG — زمان نصب: $minutes دقیقه" "Full install log: $LOG — took $minutes minutes")"
  } > "$REPORT"

  # The report holds the secrets: to the screen and the root-only file only,
  # never to the log.
  {
    printf '\n%s%s%s\n' "$B$G" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "$N"
    cat "$REPORT"
    printf '%s%s%s\n' "$B$G" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "$N"
    printf '%s\n' "$(L "همین متن در $REPORT هم ذخیره شد (فقط root می‌خواند). بعد از برداشتن دو رمز، می‌توانید پاکش کنید." "The same text is in $REPORT (root only). Once the two secrets are saved elsewhere, you may delete it.")"
  } >&4
  printf '\n%s\n' "$(L "گزارش (با رمزها) در $REPORT است." "The report (with the secrets) is in $REPORT.")" >> "$LOG"
  if ! unattended && [ -t 3 ]; then
    printf '\n  %s ' "$(L "دو رمز بالا را جای امنی بیرون از سرور ذخیره کردید؟ Enter بزنید." "Have you saved the two secrets above away from the server? Press Enter.")" >&4
    IFS= read -r -u 3 _ || true
  fi
}

# ======================================================================= main

main() {
  while [ $# -gt 0 ]; do
    case $1 in
      --answers)
        # shellcheck disable=SC1090
        set -a && . "$2" && set +a
        shift 2
        ;;
      --yes) SK_ASSUME_YES=1 && shift ;;
      *) shift ;;
    esac
  done
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: curl -fsSL <address> | sudo bash   /   sudo ./install.sh" >&2
    echo "با دسترسی root اجرا کنید: sudo ./install.sh" >&2
    exit 1
  fi
  setup_io
  trap on_exit EXIT

  ask_language
  printf '\n%s%s%s\n' "$B" "$(L "نصب شاه‌کلید" "Shah Kelid installer")" "$N"
  note "$(L "اول همه‌ی سؤال‌ها پرسیده و بررسی می‌شوند؛ تا وقتی تأیید نکنید، چیزی روی سرور تغییر نمی‌کند." "All the questions come first, and are checked; nothing on the server changes until you confirm.")"

  find_existing
  preflight
  choose SK_MODE "$(L "چه کاری انجام شود؟" "What would you like to do?")" new \
    "new:$(L "نصب تازه (فروشگاه نو)" "A new install (a new shop)")" \
    "restore:$(L "انتقال به این سرور از روی پشتیبان (سرور قبلی از دست رفته یا عوض می‌شود)" "Move here from a backup (the old server is gone or being replaced)")"
  ask_code
  ask_address
  ask_owner
  ask_mail
  ask_payments
  ask_telegram
  ask_backups
  [ "$SK_MODE" = new ] || ask_restore_secrets
  ask_extras
  summary

  install_system
  install_firewall
  install_docker
  install_code
  configure
  start
  if [ "$SK_MODE" = restore ]; then
    restore_backup
  else
    make_owner
  fi
  first_backup
  check_site
  report
}

main "$@"
