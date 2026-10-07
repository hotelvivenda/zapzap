#!/usr/bin/env bash
# Atualiza o ZapZap CRM para a versão mais nova do GitHub.
# Mantém a senha, os atendentes, os clientes e as conversas. Instalado como: zapzap-update
set -euo pipefail

APP_DIR=/opt/zapzap
[ "$(id -u)" -eq 0 ] || { echo "Rode como administrador (root)."; exit 1; }
# shellcheck disable=SC1091
[ -f /etc/zapzap.repo ] && . /etc/zapzap.repo
REPO="${ZAP_REPO:-https://github.com/hotelvivenda/zapzap.git}"
BRANCH="${ZAP_BRANCH:-}"

with_token() { echo "${REPO/https:\/\//https://x-access-token:${ZAP_GIT_TOKEN}@}"; }
fetch_latest() {
  local url="$REPO"
  [ -z "${ZAP_GIT_TOKEN:-}" ] || url=$(with_token)
  git -C "$APP_DIR" fetch -q --depth 1 "$url" "${BRANCH:-HEAD}"
}

echo "1/3 Fazendo uma cópia de segurança dos dados..."
/usr/local/bin/zapzap-backup

echo "2/3 Buscando a versão mais nova..."
if ! fetch_latest 2>/dev/null; then
  if [ -z "${ZAP_GIT_TOKEN:-}" ] && [ -r /dev/tty ]; then
    read -r -s -p "Não consegui baixar. Se o repositório for privado, cole o token de leitura do GitHub (Enter cancela): " ZAP_GIT_TOKEN </dev/tty || ZAP_GIT_TOKEN=""
    echo
    [ -n "$ZAP_GIT_TOKEN" ] || { echo "Atualização cancelada. Nada foi alterado."; exit 1; }
    fetch_latest || { echo "Não consegui baixar mesmo com o token. Nada foi alterado."; exit 1; }
  else
    echo "Não consegui baixar a versão nova. Nada foi alterado."
    exit 1
  fi
fi

# Roda o instalador da versão NOVA, a partir de uma cópia, porque ele troca os arquivos da pasta onde está.
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
git -C "$APP_DIR" show FETCH_HEAD:deploy/install.sh >"$TMP"

echo "3/3 Instalando a versão nova..."
ZAP_REPO="$REPO" ZAP_BRANCH="$BRANCH" ZAP_GIT_TOKEN="${ZAP_GIT_TOKEN:-}" bash "$TMP"
