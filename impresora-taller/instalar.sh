#!/bin/bash
# Instala el servicio de impresión de etiquetas QR en el PC del taller (Linux Mint).
# No necesita permisos de administrador: queda como servicio del usuario y
# se inicia solo al entrar a la sesión.
set -e
DIR="$HOME/impresora-taller"
mkdir -p "$DIR" "$HOME/.config/systemd/user"
cp "$(dirname "$0")/servidor.py" "$DIR/servidor.py"

cat > "$HOME/.config/systemd/user/impresora-taller.service" <<UNIT
[Unit]
Description=Impresión de etiquetas QR (Omega Eléctrica)

[Service]
ExecStart=/usr/bin/python3 $DIR/servidor.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable impresora-taller.service
systemctl --user restart impresora-taller.service
sleep 1
echo
if curl -fsS http://127.0.0.1:9101/ping; then
  echo
  echo "Listo: el servicio está funcionando."
else
  echo "El servicio no respondió. Revisa con: systemctl --user status impresora-taller.service"
  exit 1
fi
