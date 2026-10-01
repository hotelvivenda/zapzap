#!/usr/bin/env bash
# Instalador do ZapZap CRM.
# Para Ubuntu 22.04/24.04 ou Debian 12, rodando como administrador (root).
# Pode ser executado de novo a qualquer momento: nesse caso ele só ATUALIZA o sistema
# (a senha, os dados e a configuração são preservados).
set -euo pipefail

APP_DIR=/opt/zapzap
ENV_FILE=/etc/zapzap.env
REPO="${ZAP_REPO:-https://github.com/hotelvivenda/zapzap.git}"
BRANCH="${ZAP_BRANCH:-}"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mAviso: %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mErro: %s\033[0m\n' "$*" >&2; exit 1; }

ask() { # ask VARIAVEL "Pergunta" [secreto]
  local var=$1 prompt=$2 secret=${3:-}
  [ -n "${!var:-}" ] && return 0
  [ -r /dev/tty ] || die "Sem terminal para perguntar. Defina $var antes de rodar."
  if [ -n "$secret" ]; then read -r -s -p "$prompt" "$var" </dev/tty; echo; else read -r -p "$prompt" "$var" </dev/tty; fi
}

[ "$(id -u)" -eq 0 ] || die "Rode como administrador (root). No terminal da Hostinger você já entra assim."
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in ubuntu | debian) ;; *) die "Sistema não suportado (${PRETTY_NAME:-desconhecido}). Use Ubuntu 22.04/24.04 ou Debian 12." ;; esac

FIRST_INSTALL=1
[ -f "$ENV_FILE" ] && FIRST_INSTALL=0

# ---------- Perguntas (só na primeira instalação) ----------
if [ "$FIRST_INSTALL" = 1 ]; then
  ask ZAP_ADMIN_NAME "Seu nome (aparece nas mensagens que você enviar): "
  ZAP_ADMIN_NAME=$(printf '%s' "$ZAP_ADMIN_NAME" | tr -d '"\\$\n\r' | cut -c1-60)
  [ -n "$ZAP_ADMIN_NAME" ] || die "Informe o seu nome."
  ask ZAP_DOMAIN "Endereço do CRM (ex: crm.hotelvivenda.com.br): "
  [[ "$ZAP_DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Endereço inválido: $ZAP_DOMAIN"
  PW_GIVEN="${ZAP_PASSWORD:-}"
  while :; do
    ask ZAP_PASSWORD "Crie a sua senha (mínimo 8 caracteres). O usuário para entrar será: admin. " secret
    [ "${#ZAP_PASSWORD}" -ge 8 ] && break
    echo "A senha precisa ter pelo menos 8 caracteres."
    [ -z "$PW_GIVEN" ] || die "A senha informada é curta demais."
    ZAP_PASSWORD=""
  done
  if [ -z "$PW_GIVEN" ]; then
    ZAP_PASSWORD2=""
    ask ZAP_PASSWORD2 "Repita a senha: " secret
    [ "$ZAP_PASSWORD" = "$ZAP_PASSWORD2" ] || die "As senhas não conferem. Rode de novo."
  fi
fi
# Para repositório privado: ZAP_GIT_TOKEN com um token de leitura do GitHub.
GIT_URL="$REPO"
if [ -n "${ZAP_GIT_TOKEN:-}" ]; then GIT_URL="${REPO/https:\/\//https://x-access-token:${ZAP_GIT_TOKEN}@}"; fi

# ---------- Conferência do endereço (DNS) ----------
if [ "$FIRST_INSTALL" = 1 ]; then
  MY_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)
  DNS_IP=$(getent ahostsv4 "$ZAP_DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
  if [ -z "$DNS_IP" ] || { [ -n "$MY_IP" ] && [ "$DNS_IP" != "$MY_IP" ]; }; then
    warn "O endereço $ZAP_DOMAIN aponta para '${DNS_IP:-nada}', mas esta VPS é $MY_IP."
    warn "Sem isso o cadeado (HTTPS) não é emitido. Veja o passo do DNS no guia."
    if [ -z "${ZAP_FORCE:-}" ]; then
      ask ZAP_GO "Continuar mesmo assim? (digite s para continuar): "
      [ "${ZAP_GO,,}" = "s" ] || die "Instalação cancelada. Ajuste o DNS e rode de novo."
    fi
  fi
fi

# ---------- Pacotes ----------
say "Instalando programas necessários (pode levar alguns minutos)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg sqlite3 ufw debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# Máquinas com pouca memória precisam de uma área de troca para montar a tela.
if [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 1500 ] && [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  say "Criando área de troca (memória pequena)"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# ---------- Código ----------
say "Baixando o CRM"
id zapzap >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin zapzap
mkdir -p "$APP_DIR"
[ -d "$APP_DIR/.git" ] || git -C "$APP_DIR" init -q
git -C "$APP_DIR" fetch -q --depth 1 "$GIT_URL" "${BRANCH:-HEAD}" || die "Não consegui baixar o código. Se o repositório for privado, use ZAP_GIT_TOKEN (veja o guia)."
git -C "$APP_DIR" reset -q --hard FETCH_HEAD

say "Montando o sistema"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund
npm install --prefix web --no-audit --no-fund
npm run build --prefix web
install -d -o zapzap -g zapzap -m 700 "$APP_DIR/data"

# ---------- Configuração ----------
if [ "$FIRST_INSTALL" = 1 ]; then
  HASH=$(printf '%s' "$ZAP_PASSWORD" | node server/src/hash-password.js)
  umask 077
  cat >"$ENV_FILE" <<ENV
PORT=3000
HOST=127.0.0.1
CRM_PASSWORD_HASH=$HASH
CRM_ADMIN_NAME=$ZAP_ADMIN_NAME
WHATSAPP_PROVIDER=mock
ENV
  chown root:zapzap "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  umask 022

  cat >/etc/caddy/Caddyfile <<CADDY
$ZAP_DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
fi

cat >/etc/systemd/system/zapzap.service <<UNIT
[Unit]
Description=ZapZap CRM
After=network.target

[Service]
User=zapzap
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server/src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
UNIT

# ---------- Cópia de segurança diária ----------
cat >/usr/local/bin/zapzap-backup <<'BACKUP'
#!/bin/sh
set -e
DB=/opt/zapzap/data/crm.db
[ -f "$DB" ] || exit 0
mkdir -p /var/backups/zapzap && chmod 700 /var/backups/zapzap
OUT=/var/backups/zapzap/crm-$(date +%F).db
rm -f "$OUT" "$OUT.gz"
sqlite3 "$DB" ".backup '$OUT'"
gzip -f "$OUT"
find /var/backups/zapzap -name 'crm-*.db.gz' -mtime +14 -delete
BACKUP
chmod 700 /usr/local/bin/zapzap-backup
echo '30 3 * * * root /usr/local/bin/zapzap-backup' >/etc/cron.d/zapzap-backup
chmod 644 /etc/cron.d/zapzap-backup

# ---------- Comando para recuperar o acesso ----------
cat >/usr/local/bin/zapzap-password <<'PW'
#!/bin/bash
# Define uma nova senha para um usuário (serve também para quem esqueceu a senha).
set -euo pipefail
read -r -p "Usuário (Enter para 'admin'): " U </dev/tty
U=${U:-admin}
read -r -s -p "Nova senha (mínimo 8 caracteres): " P </dev/tty; echo
[ "${#P}" -ge 8 ] || { echo "Senha curta demais."; exit 1; }
cd /opt/zapzap
printf '%s' "$P" | runuser -u zapzap -- node server/src/reset-password.js "$U" 2>&1 | grep -v -i 'experimental\|trace-warnings'
echo "Quem estava logado com esse usuário precisará entrar de novo."
PW
chmod 700 /usr/local/bin/zapzap-password

# ---------- Firewall ----------
if [ "$FIRST_INSTALL" = 1 ]; then
  SSH_PORT=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')
  ufw allow "${SSH_PORT:-22}/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# ---------- Ligar ----------
say "Iniciando"
systemctl daemon-reload
systemctl enable zapzap >/dev/null 2>&1
systemctl restart zapzap
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

for _ in $(seq 1 20); do
  curl -fsS http://127.0.0.1:3000/api/me >/dev/null 2>&1 && OK=1 && break
  sleep 1
done
[ "${OK:-}" = 1 ] || die "O CRM não respondeu. Veja o motivo com:  journalctl -u zapzap -n 50 --no-pager"

DOMAIN_SHOWN="${ZAP_DOMAIN:-$(awk 'NR==1{print $1}' /etc/caddy/Caddyfile)}"
say "Pronto!"
cat <<FIM

  Abra no navegador:  https://$DOMAIN_SHOWN
  (o cadeado pode levar 1 ou 2 minutos para aparecer na primeira vez)

  Cópia de segurança diária: /var/backups/zapzap (guarda 14 dias)
  Para entrar: usuário  admin  e a senha que você criou.
  Depois, crie os atendentes na aba Equipe.
  Para atualizar o CRM no futuro, rode este instalador de novo.
  Se algo der errado:  journalctl -u zapzap -n 50 --no-pager

FIM
