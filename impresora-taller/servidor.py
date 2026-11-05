#!/usr/bin/env python3
"""
Servicio local de impresión de etiquetas QR (Omega Eléctrica).

Corre en el PC del taller y escucha SOLO en 127.0.0.1:9101.
La página Control Equipos le manda los datos de la etiqueta y este servicio
imprime el QR con el comando QR nativo de la impresora (ESC/POS), enviándolo
directo a la cola de CUPS en modo "raw" (sin pasar por el driver de imagen).
"""
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PUERTO = 9101
IMPRESORA = "POS80"          # nombre de la cola en CUPS (lpstat -p)
CODEPAGE = "cp850"           # acentos y ñ (ESC t 2)
CORTAR = False               # True si la impresora tiene cortador
MAX_COPIAS = 5
ORIGENES_PERMITIDOS = {
    "https://daijinn-bkr.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
}

ESC, GS = b"\x1b", b"\x1d"


def cod(texto, maximo):
    return str(texto or "")[:maximo].encode(CODEPAGE, errors="replace")


def qr_nativo(texto):
    datos = texto.encode("utf-8")
    n = len(datos) + 3
    # QR más grande mientras el enlace sea corto (ancho útil: 576 puntos)
    tam = 8 if len(datos) <= 100 else 6 if len(datos) <= 200 else 4
    return (
        GS + b"(k\x04\x001A2\x00"                      # modelo 2
        + GS + b"(k\x03\x001C" + bytes([tam])          # tamaño del módulo
        + GS + b"(k\x03\x001E1"                        # corrección de errores M
        + GS + b"(k" + bytes([n % 256, n // 256]) + b"1P0" + datos
        + GS + b"(k\x03\x001Q0"                        # imprimir
    )


def etiqueta(d):
    """Arma los bytes ESC/POS de una etiqueta (misma info que la etiqueta de la página)."""
    qr = str(d.get("qr") or "")
    if not qr or len(qr) > 500:
        raise ValueError("qr inválido")
    b = ESC + b"@"                                     # reiniciar
    b += ESC + b"t\x02"                                # tabla de caracteres CP850
    b += ESC + b"a\x01"                                # centrar
    b += qr_nativo(qr) + b"\n"
    b += ESC + b"E\x01" + GS + b"!\x11"                # negrita + doble tamaño
    b += cod(d.get("id"), 20) + b"\n"
    b += GS + b"!\x00"                                 # tamaño normal
    if d.get("cliente"):
        b += cod(d["cliente"], 48) + b"\n"
    b += ESC + b"E\x00"
    if d.get("fecha"):
        b += cod("Ingreso: " + str(d["fecha"]), 48) + b"\n"
    b += ESC + b"E\x01" + cod(d.get("empresa") or "OMEGA ELÉCTRICA", 32) + b"\n" + ESC + b"E\x00"
    b += b"\n\n\n"
    if CORTAR:
        b += GS + b"V\x42\x00"
    return b


def enviar(datos):
    r = subprocess.run(["lp", "-d", IMPRESORA, "-o", "raw"], input=datos,
                       capture_output=True, timeout=15)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode(errors="replace").strip() or "lp falló")


class Manejador(BaseHTTPRequestHandler):
    server_version = "QRTaller/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self):
        origen = self.headers.get("Origin")
        if origen and origen not in ORIGENES_PERMITIDOS:
            return False
        if origen:
            self.send_header("Access-Control-Allow-Origin", origen)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        return True

    def _responder(self, codigo, obj):
        cuerpo = json.dumps(obj).encode()
        self.send_response(codigo)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _origen_ok(self):
        origen = self.headers.get("Origin")
        return not origen or origen in ORIGENES_PERMITIDOS

    def do_OPTIONS(self):
        if not self._origen_ok():
            return self._responder(403, {"ok": False, "error": "origen no permitido"})
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self._origen_ok():
            return self._responder(403, {"ok": False, "error": "origen no permitido"})
        if self.path == "/ping":
            return self._responder(200, {"ok": True, "impresora": IMPRESORA})
        self._responder(404, {"ok": False, "error": "no existe"})

    def do_POST(self):
        if not self._origen_ok():
            return self._responder(403, {"ok": False, "error": "origen no permitido"})
        if self.path != "/imprimir":
            return self._responder(404, {"ok": False, "error": "no existe"})
        try:
            largo = int(self.headers.get("Content-Length") or 0)
            if largo <= 0 or largo > 4096:
                raise ValueError("tamaño inválido")
            d = json.loads(self.rfile.read(largo))
            copias = max(1, min(MAX_COPIAS, int(d.get("copias") or 1)))
            enviar(etiqueta(d) * copias)
        except (ValueError, KeyError, TypeError) as e:
            return self._responder(400, {"ok": False, "error": str(e)})
        except Exception as e:
            return self._responder(500, {"ok": False, "error": str(e)})
        self._responder(200, {"ok": True})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador).serve_forever()
