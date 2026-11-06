# Control de Equipos · Omega Eléctrica

Reemplazo de la app de AppSheet "Control Equipos". Es una página web que se abre desde el celular o el PC; los datos quedan en Supabase, así que todos ven lo mismo al instante.

**Qué hace (igual que la app anterior):**
- Ficha por equipo con los mismos campos: cliente, tipo de motor, voltaje, tipo de mantenimiento, encargado/s, las 9 mediciones (T-U … W-Z), rodamientos, sello, retén, placa bornera, proceso, notas y estado.
- Fotos y videos por equipo (las fotos se achican solas para no llenar el espacio).
- **QR por equipo**: se imprime desde la ficha ("Imprimir etiqueta QR"), se pega al equipo y al escanearlo con la cámara del celular se abre directo la ficha.
- Además: escáner dentro de la app, búsqueda y filtro por estado, exportar a CSV (Excel), instalable como app en el celular.

## Puesta en marcha

1. **Crear el proyecto** en [supabase.com](https://supabase.com) (gratis) → New project.
2. **Crear las tablas**: SQL Editor → New query → pegar todo `schema.sql` → **Run**.
3. **Usuarios**:
   - Authentication → Sign In / Providers → desactiva **Allow new users to sign up** (así nadie de afuera se puede registrar).
   - Authentication → Users → **Add user** → crea uno por persona (o uno para bodega) con correo y contraseña, marcando *Auto confirm user*.
4. **Conectar la página**: Project Settings → API → copia la **Project URL** y la clave **anon public** (o *publishable*) y pégalas en `config.js`. No uses la `service_role`/`secret`.
5. **Probar en tu PC**: en esta carpeta, `python -m http.server 8000` y abre http://localhost:8000
6. **Publicar** (la cámara y la instalación solo funcionan con HTTPS): Netlify (arrastrar la carpeta en app.netlify.com/drop), Cloudflare Pages o GitHub Pages.

> ⚠️ **Imprime los QR solo cuando la página ya esté publicada en su dirección definitiva.** El QR lleva la dirección desde donde se abrió la app; si la imprimes desde `localhost` no va a funcionar en los celulares.

## Cuentas de cliente (solo lectura)

Cada cliente puede tener su propia cuenta para **ver únicamente sus equipos**: ficha, mediciones, fotos y videos. No puede crear, editar, borrar, subir archivos ni imprimir etiquetas. Esto está protegido en la base de datos (Supabase), no solo en la pantalla: aunque alguien manipule la página, Supabase no le entrega ni le deja cambiar datos de otros.

**Activarlo:** en Supabase → SQL Editor, pegar y ejecutar `clientes.sql` completo (también cuando se actualiza este archivo: se puede repetir sin problema). Los usuarios que ya existen quedan como *personal* (acceso completo, igual que ahora). Hazlo **antes** de crear usuarios de clientes.

**Crear una cuenta de cliente:**
1. Supabase → Authentication → Users → *Add user* (correo y contraseña, marcando *Auto Confirm User*).
2. En la app, entrar con una cuenta de personal → **Cuentas de clientes**. La cuenta nueva aparece en *Sin asignar*: se elige el cliente de la lista (o se escribe uno nuevo) y se pulsa **Guardar**.

Desde esa misma pantalla se puede cambiar a alguien a *Personal de Omega* o **Quitar acceso**. (`alta-cliente.sql` hace lo mismo desde el SQL Editor y queda como alternativa.)

En el formulario de un equipo, el campo **Cliente** sugiere los nombres que ya existen, para que se escriban siempre igual.

**Reglas:**
- Un usuario **sin perfil no ve nada** (así una cuenta creada por error no queda con acceso a todo). Las personas nuevas de Omega necesitan su perfil *personal*: se les da en la pantalla **Cuentas de clientes**.
- El cliente ve todos los datos de su equipo, incluidos encargados, proceso y notas.
- Para quitar el acceso a un cliente basta borrar su perfil (también está en `alta-cliente.sql`).

## Impresora térmica del taller (3nStar RPT004, Linux Mint)

Esta impresora no entiende las imágenes que manda el navegador, pero sí imprime QR con su comando nativo. Por eso el PC del taller usa un pequeño servicio local (carpeta `impresora-taller/`):

1. Requisito: la impresora ya debe estar agregada en CUPS con el nombre `POS80` (modo raw no es necesario; el servicio manda los datos directo).
2. En el PC del taller, descargar la carpeta `impresora-taller` y ejecutar `bash instalar.sh`. Queda como servicio del usuario y se inicia solo.
3. Desde ese PC, "Imprimir etiqueta QR" imprime directo (QR + ID + cliente + fecha). En celulares u otros PC, sigue funcionando el método de siempre (`window.print()`).

El servicio solo escucha en `127.0.0.1:9101` y solo acepta pedidos desde la página publicada. Si la impresora tiene cortador, cambia `CORTAR = True` en `servidor.py`.

## Uso diario
- **Equipo nuevo**: "+ Nuevo equipo" → llenar → Guardar. Solo el cliente es obligatorio.
- **Etiqueta**: en la ficha, "Imprimir etiqueta QR" (QR + ID + cliente).
- **Consultar**: escanear el QR con la cámara del celular, o "Escanear QR" dentro de la app.
- **Fotos/videos**: en la ficha, "+ Agregar fotos" / "+ Agregar video" (máx. 50 MB por video).

Las listas de sugerencias (tipo de motor, tipo de mantenimiento, rodamientos y estados) se cambian en `config.js`.

## Archivos
| Archivo | Para qué |
|---|---|
| `schema.sql` | Tablas, reglas de seguridad y bucket de fotos/videos (se ejecuta una vez en Supabase) |
| `config.js` | URL y clave de Supabase, y listas de opciones |
| `index.html` | Pantalla y estilos |
| `app.js` | Lógica de la aplicación |
| `sw.js`, `manifest.webmanifest`, `icons/` | Para instalarla como app |

## Límites del plan gratis de Supabase
500 MB de base de datos y 1 GB de archivos. Las fotos reducidas pesan ~300 KB, así que caben miles; los videos son lo que más ocupa. Si el proyecto no se usa en 7 días, Supabase lo pausa y hay que reactivarlo desde el panel.
