"use strict";
// Control de Equipos · Omega Eléctrica

const CFG = window.CONFIG;
const OPC = CFG.OPCIONES || {};
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const BUCKET = "equipos";
const MAX_VIDEO = 50 * 1024 * 1024; // 50 MB, límite del plan gratis

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Campos (mismo orden que la app de AppSheet) ----------
const GENERAL = [
  { k: "cliente", l: "Cliente", req: true, op: "cliente" },
  { k: "tipo_motor", l: "Tipo de motor", op: "tipo_motor" },
  { k: "tipo_voltaje", l: "Tipo de voltaje" },
  { k: "tipo_mantenimiento", l: "Tipo de mantenimiento", op: "tipo_mantenimiento" },
  { k: "encargados", l: "Encargado/s" },
];
const MEDICIONES = [
  ["t_u", "T-U"], ["t_v", "T-V"], ["t_w", "T-W"],
  ["u_v", "U-V"], ["u_w", "U-W"], ["v_w", "V-W"],
  ["u_x", "U-X"], ["v_y", "V-Y"], ["w_z", "W-Z"],
];
const COMPONENTES = [
  { k: "rodamientos", l: "Rodamientos", op: "rodamientos" },
  { k: "sello", l: "Sello" },
  { k: "reten", l: "Retén" },
  { k: "placa_bornera", l: "Placa bornera" },
];
const CIERRE = [
  { k: "proceso", l: "Proceso", area: true },
  { k: "notas", l: "Notas adicionales", area: true },
];
const TEXTO = [...GENERAL, ...COMPONENTES, ...CIERRE, { k: "estado", l: "Estado" }];

// ---------- Estado de la app ----------
let equipos = [];
let usuario = null;
let canal = null;
// Perfil de la cuenta: { rol: "personal" | "cliente", cliente } o null si aún no tiene acceso.
// Los clientes solo ven sus equipos y no pueden modificar nada. Esto es solo la pantalla:
// la protección real está en Supabase (clientes.sql).
let perfil = null;
const soloLectura = () => perfil?.rol !== "personal";
let escaner = null;

// ---------- Utilidades ----------
let tAviso;
function aviso(msg, error = false) {
  const a = $("#aviso");
  a.textContent = msg;
  a.className = "ver" + (error ? " error" : "");
  clearTimeout(tAviso);
  tAviso = setTimeout(() => (a.className = ""), error ? 6000 : 3000);
}
function fecha(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}
// 02-11-2026 16:24
function fechaHora(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function claseEstado(e) {
  const s = String(e || "").toLowerCase();
  if (!s) return "";
  if (s.includes("pend")) return "pendiente";
  if (s.includes("termin") || s.includes("entreg") || s.includes("list")) return "listo";
  return "proceso";
}
function chipEstado(e) {
  return e ? `<span class="chip ${claseEstado(e)}">${esc(e)}</span>` : "";
}
// Enlace del QR: ID + clave secreta del equipo. Con la clave, quien escanea ve ESE equipo sin iniciar sesión.
function linkEquipo(e) {
  return location.origin + location.pathname + "#equipo=" + encodeURIComponent(e.id) +
    (e.token ? "&t=" + encodeURIComponent(e.token) : "");
}
function qrUrl(texto, size = 300) {
  return `https://quickchart.io/qr?size=${size}&margin=1&ecLevel=M&text=${encodeURIComponent(texto)}`;
}
function unicos(lista) {
  return [...new Set(lista.filter((v) => v != null && String(v).trim() !== ""))];
}
function opciones(op) {
  const lista = unicos([...(OPC[op] || []), ...equipos.map((e) => e[op])]);
  if (op !== "cliente") return lista;
  // Clientes: "Condominio Y" y " condominio  y " son el mismo nombre; se muestra solo uno.
  const vistos = new Map();
  for (const n of lista) { const k = normNombre(n); if (!vistos.has(k)) vistos.set(k, String(n).trim()); }
  return [...vistos.values()];
}
function numero(v) {
  return v == null ? "—" : String(v).replace(".", ",");
}

// ---------- Sesión ----------
async function iniciar() {
  sb.auth.onAuthStateChange((_ev, sesion) => setSesion(sesion));
  const { data } = await sb.auth.getSession();
  setSesion(data.session);
}

function setSesion(sesion) {
  const antes = usuario;
  usuario = sesion?.user ?? null;
  $("#app").hidden = !usuario;
  if (usuario) { $("#vista-login").hidden = true; $("#publico").hidden = true; }
  else mostrarSinSesion();
  if (usuario && !antes) {
    cargarPerfil().then(cargarEquipos).then(router);
    suscribir();
  }
  if (!usuario && antes) {
    equipos = [];
    bobinados = [];
    perfil = null;
    aplicarPerfil();
    if (canal) { sb.removeChannel(canal); canal = null; }
  }
}

async function cargarPerfil() {
  const { data, error } = await sb.from("perfiles").select("rol,cliente").eq("user_id", usuario.id).maybeSingle();
  if (error) {
    // Si todavía no se ejecutó clientes.sql (no existe la tabla), todos son personal como antes.
    if (error.code === "PGRST205" || error.code === "42P01") perfil = { rol: "personal" };
    else { perfil = null; aviso("No se pudo verificar tu cuenta: " + error.message, true); }
  } else {
    perfil = data;
  }
  aplicarPerfil();
}

// Muestra u oculta lo que solo puede usar el personal de Omega.
function aplicarPerfil() {
  document.body.classList.toggle("solo-lectura", soloLectura());
  const c = $("#cuenta");
  c.textContent = perfil?.rol === "cliente" ? perfil.cliente : "";
  c.hidden = !c.textContent;
}

$("#form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = $("#btn-entrar");
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $("#login-correo").value.trim(),
    password: $("#login-clave").value,
  });
  btn.disabled = false;
  if (error) aviso("No se pudo entrar: revisa el correo y la contraseña.", true);
});

$("#btn-salir").addEventListener("click", async () => {
  await detenerEscaner();
  await sb.auth.signOut();
});

// ---------- Vista pública (QR, sin iniciar sesión) ----------
// Solo muestra UN equipo, y solo si el ID y la clave del enlace coinciden (lo comprueba Supabase).
function enlacePublico() {
  const p = new URLSearchParams(location.hash.slice(1));
  return p.get("equipo") && p.get("t") ? { id: p.get("equipo"), token: p.get("t") } : null;
}

function mostrarSinSesion() {
  const pub = enlacePublico();
  $("#vista-login").hidden = !!pub;
  $("#publico").hidden = !pub;
  if (pub) verPublico(pub);
}

async function verPublico({ id, token }) {
  const cont = $("#detalle-publico");
  cont.innerHTML = `<p class="vacio">Cargando…</p>`;
  const { data, error } = await sb.rpc("equipo_publico", { p_id: id, p_token: token });
  if (error) { cont.innerHTML = `<p class="vacio">No se pudo cargar el equipo. Revisa tu conexión.</p>`; return; }
  if (!data) { cont.innerHTML = `<p class="vacio">No se encontró el equipo, o el enlace ya no es válido.</p>`; return; }
  const e = data.equipo;
  const url = (ruta) => sb.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
  cont.innerHTML = `
    <div class="panel">
      <div class="cabecera">
        <div>
          <h1 style="margin:0">${esc(e.cliente || "(sin cliente)")}</h1>
          <div class="muted">${esc(e.tipo_motor || "")}</div>
          <div class="muted small" style="margin-top:4px">ID ${esc(e.id)}</div>
        </div>
        ${chipEstado(e.estado)}
      </div>
    </div>
    ${panelesFicha(e)}
    <div class="panel">
      <h2>Fotos</h2>
      <div class="galeria">${data.fotos.length ? data.fotos.map((r) => `
        <figure><a href="${esc(url(r))}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(url(r))}" alt="Foto del equipo"></a></figure>`).join("")
        : `<p class="muted small" style="grid-column:1/-1;margin:0">Sin fotos.</p>`}</div>
    </div>
    <div class="panel">
      <h2>Videos</h2>
      <div class="videos">${data.videos.length ? data.videos.map((r) => `
        <figure><video controls preload="metadata" playsinline src="${esc(url(r))}"></video></figure>`).join("")
        : `<p class="muted small" style="margin:0">Sin videos.</p>`}</div>
    </div>
    <p class="muted small">Vista de solo lectura · Creado ${fecha(e.creado_en)} · Última modificación ${fecha(e.actualizado_en)}</p>`;
}

// ---------- Datos ----------
async function cargarEquipos() {
  const { data, error } = await sb.from("equipos").select("*").order("creado_en", { ascending: false });
  if (error) { aviso("Error al cargar equipos: " + error.message, true); return; }
  equipos = data;
  llenarFiltroEstado();
}

function guardarLocal(e) {
  const i = equipos.findIndex((x) => x.id === e.id);
  if (i >= 0) equipos[i] = e; else equipos.unshift(e);
}

function suscribir() {
  canal = sb.channel("equipos-cambios")
    .on("postgres_changes", { event: "*", schema: "public", table: "equipos" }, (p) => {
      if (p.eventType === "DELETE") equipos = equipos.filter((x) => x.id !== p.old.id);
      else guardarLocal(p.new);
      const h = location.hash;
      if (h === "" || h === "#") renderLista();
      else if (p.new?.id && new URLSearchParams(h.slice(1)).get("equipo") === p.new.id) verDetalle(p.new.id, true);
    })
    .subscribe();
}

// ---------- Navegación ----------
function mostrar(nombre) {
  for (const v of document.querySelectorAll(".vista")) v.hidden = v.id !== "vista-" + nombre;
  const enBob = nombre.startsWith("bobinado");
  document.body.classList.toggle("en-bob", enBob);
  $("#logo-link").setAttribute("href", enBob ? "#bobinado" : "#");
  window.scrollTo(0, 0);
}

function router() {
  if (!usuario) { mostrarSinSesion(); return; }
  const h = location.hash.slice(1);
  const p = new URLSearchParams(h);
  if (h !== "escanear") detenerEscaner();
  if (soloLectura() && (p.has("editar") || h === "nuevo" || h === "cuentas" || h.startsWith("bobinado"))) { location.hash = ""; return; }
  if (h.startsWith("bobinado")) return routerBobinado(h, p);
  if (p.has("equipo")) return verDetalle(p.get("equipo"));
  if (p.has("editar")) return verFormulario(p.get("editar"));
  if (h === "nuevo") return verFormulario(null);
  if (h === "escanear") return verEscaner();
  if (h === "cuentas") return verCuentas();
  mostrar("lista");
  renderLista();
}
window.addEventListener("hashchange", router);

// ---------- Cuentas de clientes (solo personal) ----------
// Las cuentas (correo y contraseña) se crean en Supabase → Authentication → Users → Add user.
// Aquí el personal les asigna un cliente (o las deja como personal). La seguridad real está
// en las funciones de clientes.sql: un cliente no puede usarlas aunque abra esta pantalla.
const normNombre = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

async function verCuentas() {
  mostrar("cuentas");
  const ref = new URL(CFG.SUPABASE_URL).hostname.split(".")[0];
  $("#cuentas-ayuda").innerHTML =
    `Para crear una cuenta nueva: <a href="https://supabase.com/dashboard/project/${esc(ref)}/auth/users" target="_blank" rel="noopener">Supabase → Authentication → Users → Add user</a> ` +
    `(marca <b>Auto Confirm User</b>). Después aparece aquí, en “Sin asignar”, y le eliges el cliente.`;
  const cont = $("#cuentas-lista");
  cont.innerHTML = `<p class="vacio">Cargando…</p>`;
  const { data, error } = await sb.rpc("cuentas_listar");
  if (error) { cont.innerHTML = `<p class="vacio">No se pudo cargar: ${esc(error.message)}</p>`; return; }

  const vistos = new Map();
  for (const n of [...opciones("cliente"), ...data.filter((c) => c.rol === "cliente").map((c) => c.cliente)]) {
    if (normNombre(n) && !vistos.has(normNombre(n))) vistos.set(normNombre(n), String(n).trim());
  }
  const nombres = [...vistos.values()].sort((a, b) => a.localeCompare(b, "es"));

  const fila = (c) => {
    const yo = c.user_id === usuario.id;
    const rol = c.rol || "cliente";
    return `
      <div class="cuenta" data-id="${esc(c.user_id)}">
        <div><strong>${esc(c.email)}</strong>${yo ? ' <span class="chip proceso">Tú</span>' : ""}</div>
        <div class="cuenta-ctl">
          <select class="c-rol" aria-label="Tipo de cuenta"${yo ? " disabled" : ""}>
            <option value="cliente"${rol === "cliente" ? " selected" : ""}>Cliente (solo ve lo suyo)</option>
            <option value="personal"${rol === "personal" ? " selected" : ""}>Personal de Omega (acceso completo)</option>
          </select>
          <input class="c-cli" list="dl-clientes" placeholder="Nombre del cliente" value="${esc(c.cliente || "")}" autocomplete="off"${yo ? " hidden" : ""}>
          ${yo ? "" : `<button type="button" class="primary c-guardar">Guardar</button>`}
          ${yo || !c.rol ? "" : `<button type="button" class="peligro c-quitar">Quitar acceso</button>`}
        </div>
      </div>`;
  };
  const grupo = (titulo, nota, lista) => lista.length
    ? `<div class="panel"><h2>${titulo}</h2>${nota ? `<p class="muted small" style="margin:0 0 4px">${nota}</p>` : ""}${lista.map(fila).join("")}</div>` : "";

  cont.innerHTML =
    `<datalist id="dl-clientes">${nombres.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>` +
    grupo("Sin asignar", "Pueden entrar, pero no ven nada hasta que les asignes un cliente.", data.filter((c) => !c.rol)) +
    grupo("Clientes", "", data.filter((c) => c.rol === "cliente")) +
    grupo("Personal de Omega", "", data.filter((c) => c.rol === "personal")) +
    (data.length ? "" : `<p class="vacio">Todavía no hay cuentas.</p>`);

  for (const f of cont.querySelectorAll(".cuenta")) {
    const rol = $(".c-rol", f), cli = $(".c-cli", f);
    const sync = () => { cli.hidden = rol.value !== "cliente" || rol.disabled; };
    sync();
    rol.onchange = sync;
    const guardar = $(".c-guardar", f), quitar = $(".c-quitar", f);
    if (guardar) guardar.onclick = async () => {
      const email = $("strong", f).textContent;
      if (rol.value === "cliente" && !cli.value.trim()) { aviso("Escribe o elige el nombre del cliente.", true); cli.focus(); return; }
      if (rol.value === "personal" && !confirm(`¿Dar acceso COMPLETO (ver, editar y borrar todo) a ${email}?`)) return;
      guardar.disabled = true;
      const { error } = await sb.rpc("cuenta_asignar", {
        p_user: f.dataset.id, p_rol: rol.value, p_cliente: rol.value === "cliente" ? cli.value.trim() : null,
      });
      if (error) { guardar.disabled = false; aviso(error.message, true); return; }
      aviso("Guardado.");
      verCuentas();
    };
    if (quitar) quitar.onclick = async () => {
      if (!confirm(`¿Quitar el acceso a ${$("strong", f).textContent}? Podrá entrar, pero no verá nada.`)) return;
      const { error } = await sb.rpc("cuenta_quitar", { p_user: f.dataset.id });
      if (error) { aviso(error.message, true); return; }
      aviso("Acceso quitado.");
      verCuentas();
    };
  }
}

// ---------- Lista ----------
function llenarFiltroEstado() {
  const sel = $("#filtro-estado");
  const actual = sel.value;
  sel.innerHTML = `<option value="">Todos los estados</option>` +
    opciones("estado").map((o) => `<option>${esc(o)}</option>`).join("");
  sel.value = actual;
}

function renderLista() {
  const q = $("#buscar").value.trim().toLowerCase();
  const est = $("#filtro-estado").value;
  const lista = equipos.filter((e) =>
    (!est || e.estado === est) &&
    (!q || [e.id, e.cliente, e.tipo_motor, e.tipo_voltaje, e.tipo_mantenimiento, e.encargados]
      .some((v) => String(v ?? "").toLowerCase().includes(q))));
  $("#conteo").textContent = `${lista.length} de ${equipos.length} equipos`;
  $("#lista").innerHTML = lista.length
    ? lista.map((e) => `
      <a class="tarjeta" href="#equipo=${encodeURIComponent(e.id)}">
        <div class="t-top"><strong>${esc(e.cliente || "(sin cliente)")}</strong>${chipEstado(e.estado)}</div>
        <div class="muted">${esc(e.tipo_motor || "")}${e.tipo_voltaje ? " · " + esc(e.tipo_voltaje) : ""}</div>
        <div class="muted small">ID ${esc(e.id)} · ${fecha(e.creado_en)}${e.encargados ? " · " + esc(e.encargados) : ""}</div>
      </a>`).join("")
    : `<p class="vacio">${equipos.length ? "No hay equipos que coincidan."
        : !perfil ? "Tu cuenta todavía no tiene acceso asignado. Avisa a Omega Eléctrica."
        : soloLectura() ? "Todavía no hay equipos registrados para tu cuenta."
        : "Todavía no hay equipos. Toca “+ Nuevo equipo”."}</p>`;
}
$("#buscar").addEventListener("input", renderLista);
$("#filtro-estado").addEventListener("change", renderLista);

// ---------- Ficha del equipo ----------
async function buscarEquipo(id) {
  let e = equipos.find((x) => x.id === id);
  if (e) return e;
  const { data, error } = await sb.from("equipos").select("*").eq("id", id).maybeSingle();
  if (error) { aviso(error.message, true); return null; }
  if (data) guardarLocal(data);
  return data;
}

function filaDato(c, e) {
  const v = e[c.k];
  return `<dt>${esc(c.l)}</dt><dd>${v == null || v === "" ? '<span class="muted">—</span>' : esc(v)}</dd>`;
}

// Datos, mediciones, componentes y proceso: los usa la ficha normal y la vista pública.
function panelesFicha(e) {
  return `
    <div class="panel">
      <h2>Datos</h2>
      <dl class="datos">${GENERAL.map((c) => filaDato(c, e)).join("")}</dl>
    </div>

    <div class="panel">
      <h2>Mediciones</h2>
      <div class="medidas">
        ${MEDICIONES.map(([k, l]) => `<div class="medida"><b>${numero(e[k])}</b><span>${l}</span></div>`).join("")}
      </div>
    </div>

    <div class="panel">
      <h2>Componentes</h2>
      <dl class="datos">${COMPONENTES.map((c) => filaDato(c, e)).join("")}</dl>
    </div>

    <div class="panel">
      <h2>Proceso y notas</h2>
      <dl class="datos">${CIERRE.map((c) => filaDato(c, e)).join("")}</dl>
    </div>
  `;
}

async function verDetalle(id, refresco = false) {
  if (!refresco) mostrar("detalle");
  const cont = $("#detalle");
  if (!refresco) cont.innerHTML = `<p class="vacio">Cargando…</p>`;
  const e = await buscarEquipo(id);
  if (!e) { cont.innerHTML = `<p class="vacio">No existe un equipo con ID ${esc(id)}${soloLectura() ? " o no tienes acceso a él" : ""}.</p>`; return; }
  const link = linkEquipo(e);
  cont.innerHTML = `
    <div class="panel">
      <div class="cabecera">
        <div>
          <h1 style="margin:0">${esc(e.cliente || "(sin cliente)")}</h1>
          <div class="muted">${esc(e.tipo_motor || "")}</div>
        </div>
        ${chipEstado(e.estado)}
      </div>
    </div>

    <div class="panel qr-panel">
      <img src="${qrUrl(link)}" alt="Código QR del equipo ${esc(e.id)}">
      <div>
        <div class="muted small">ID del equipo</div>
        <div style="font-size:22px;font-weight:700;letter-spacing:1px;margin-bottom:8px">${esc(e.id)}</div>
        <div class="botones">
          <button type="button" id="btn-imprimir" class="primary solo-personal">Imprimir etiqueta QR</button>
          <button type="button" id="btn-copiar">Copiar enlace</button>
          <button type="button" id="btn-regenerar" class="solo-personal">Generar enlace nuevo</button>
        </div>
      </div>
    </div>

    ${panelesFicha(e)}

    <div class="panel">
      <h2>Fotos</h2>
      <div id="fotos" class="galeria"></div>
      <label class="btn subir solo-personal">+ Agregar fotos
        <input type="file" id="in-fotos" accept="image/*" multiple>
      </label>
    </div>

    <div class="panel">
      <h2>Videos</h2>
      <div id="videos" class="videos"></div>
      <label class="btn subir solo-personal">+ Agregar video
        <input type="file" id="in-videos" accept="video/*" multiple>
      </label>
      <p class="muted small solo-personal" style="margin:8px 0 0">Máximo 50 MB por video.</p>
    </div>

    <div class="fila-acciones solo-personal">
      <a class="btn primary" href="#editar=${encodeURIComponent(e.id)}">Editar</a>
      <button type="button" class="peligro" id="btn-eliminar">Eliminar equipo</button>
    </div>
    <p class="muted small">Creado ${fecha(e.creado_en)} · Última modificación ${fecha(e.actualizado_en)}</p>
  `;

  $("#btn-imprimir").onclick = () => imprimirEtiqueta(e);
  $("#btn-copiar").onclick = async () => {
    try { await navigator.clipboard.writeText(link); aviso("Enlace copiado."); }
    catch { prompt("Copia el enlace:", link); }
  };
  $("#btn-regenerar").onclick = () => regenerarEnlace(e);
  $("#btn-eliminar").onclick = () => eliminarEquipo(e);
  $("#in-fotos").onchange = (ev) => subirArchivos(e.id, ev.target.files, "foto");
  $("#in-videos").onchange = (ev) => subirArchivos(e.id, ev.target.files, "video");
  cargarMedios(e.id);
}

async function cargarMedios(id) {
  const [f, v] = await Promise.all([
    sb.from("fotos_equipo").select("*").eq("equipo_id", id).order("creado_en"),
    sb.from("videos_equipo").select("*").eq("equipo_id", id).order("creado_en"),
  ]);
  if (f.error || v.error) { aviso((f.error || v.error).message, true); return; }
  const firmadas = {};
  const rutas = [...f.data, ...v.data].map((x) => x.ruta);
  if (rutas.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(rutas, 60 * 60);
    if (!error) data.forEach((d) => { if (d.signedUrl) firmadas[d.path] = d.signedUrl; });
  }
  const cf = $("#fotos"), cv = $("#videos");
  if (!cf || !cv) return; // el usuario ya cambió de pantalla

  cf.innerHTML = f.data.length
    ? f.data.map((x) => `
      <figure>
        <a href="${esc(firmadas[x.ruta] || "#")}" target="_blank" rel="noopener">
          <img loading="lazy" src="${esc(firmadas[x.ruta] || "")}" alt="Foto del equipo">
        </a>
        <button type="button" class="quitar" data-tabla="fotos_equipo" data-id="${x.id}" data-ruta="${esc(x.ruta)}" aria-label="Borrar foto">✕</button>
      </figure>`).join("")
    : `<p class="muted small" style="grid-column:1/-1;margin:0">Sin fotos.</p>`;

  cv.innerHTML = v.data.length
    ? v.data.map((x) => `
      <figure>
        <video controls preload="metadata" playsinline src="${esc(firmadas[x.ruta] || "")}"></video>
        <button type="button" class="quitar" data-tabla="videos_equipo" data-id="${x.id}" data-ruta="${esc(x.ruta)}" aria-label="Borrar video">✕</button>
      </figure>`).join("")
    : `<p class="muted small" style="margin:0">Sin videos.</p>`;

  for (const b of document.querySelectorAll("#detalle .quitar")) {
    b.onclick = () => borrarMedio(b.dataset.tabla, b.dataset.id, b.dataset.ruta, id);
  }
}

async function borrarMedio(tabla, mid, ruta, equipoId) {
  if (soloLectura()) return;
  if (!confirm(tabla === "fotos_equipo" ? "¿Borrar esta foto?" : "¿Borrar este video?")) return;
  const { error } = await sb.from(tabla).delete().eq("id", mid);
  if (error) { aviso(error.message, true); return; }
  await sb.storage.from(BUCKET).remove([ruta]);
  aviso("Borrado.");
  cargarMedios(equipoId);
}

// Reduce las fotos del celular (4–10 MB) a ~300 KB para ahorrar espacio.
async function reducirImagen(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    return b || file;
  } catch {
    return file; // formato que el navegador no puede leer: se sube tal cual
  }
}

async function subirArchivos(equipoId, files, tipo) {
  if (soloLectura()) return;
  const lista = [...(files || [])];
  if (!lista.length) return;
  const tabla = tipo === "foto" ? "fotos_equipo" : "videos_equipo";
  let ok = 0;
  for (let i = 0; i < lista.length; i++) {
    const file = lista[i];
    aviso(`Subiendo ${tipo} ${i + 1} de ${lista.length}…`);
    let blob = file;
    let ext = (file.name.includes(".") ? file.name.split(".").pop() : "").toLowerCase() || "bin";
    if (tipo === "foto") {
      blob = await reducirImagen(file);
      if (blob !== file) ext = "jpg";
    } else if (file.size > MAX_VIDEO) {
      aviso(`“${file.name}” pesa más de 50 MB. Grábalo más corto o en menor calidad.`, true);
      continue;
    }
    const ruta = `${equipoId}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: blob.type || file.type || undefined });
    if (up.error) { aviso("No se pudo subir: " + up.error.message, true); continue; }
    const ins = await sb.from(tabla).insert({ equipo_id: equipoId, ruta });
    if (ins.error) {
      await sb.storage.from(BUCKET).remove([ruta]);
      aviso("No se pudo guardar: " + ins.error.message, true);
      continue;
    }
    ok++;
  }
  if (ok) aviso(ok === 1 ? `${tipo === "foto" ? "Foto subida" : "Video subido"}.` : `${ok} archivos subidos.`);
  if ($("#fotos")) cargarMedios(equipoId);
}

// Impresora del taller: servicio local (impresora-taller/) que imprime el QR con el
// comando nativo de la impresora. Si no está instalado (celular, otro PC), se usa window.print().
const IMPRESORA_LOCAL = "http://127.0.0.1:9101";
const marcaLocal = () => { try { localStorage.setItem("impresora_local", "1"); } catch (_) {} };
const esPcTaller = () => { try { return localStorage.getItem("impresora_local") === "1"; } catch (_) { return false; } };

async function enviarLocal(payload) {
  const r = await fetch(IMPRESORA_LOCAL + "/imprimir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "error " + r.status);
}

function imprimirLocal(e) {
  return enviarLocal({
    qr: linkEquipo(e),
    id: e.id,
    cliente: e.cliente || "",
    fecha: fechaHora(e.creado_en),
    empresa: "OMEGA ELÉCTRICA",
    copias: 1,
  });
}

async function imprimirEtiqueta(e) {
  try {
    await imprimirLocal(e);
    marcaLocal();
    aviso("Etiqueta enviada a la impresora.");
    return;
  } catch (err) {
    // En el PC del taller (ya se usó el servicio) no se cae a window.print(): saldría basura.
    if (esPcTaller()) { aviso("La impresora del taller no responde. ¿Está encendida y con papel?", true); return; }
  }
  const et = $("#etiqueta");
  // QR en blanco y negro puro, con borde blanco suficiente para que lo lea cualquier cámara.
  const src = `https://quickchart.io/qr?size=480&margin=2&ecLevel=M&dark=000000&light=ffffff&text=${encodeURIComponent(linkEquipo(e))}`;
  et.innerHTML = `
    <img alt="" src="${src}">
    <div class="id">${esc(e.id)}</div>
    ${e.cliente ? `<div class="cli">${esc(e.cliente)}</div>` : ""}
    <div class="fec">Ingreso: ${esc(fechaHora(e.creado_en))}</div>
    <div class="emp">OMEGA ELÉCTRICA</div>`;
  const img = $("img", et);
  const lanzar = () => setTimeout(() => window.print(), 100);
  if (img.complete) lanzar();
  else { img.onload = lanzar; img.onerror = () => aviso("No se pudo generar el QR (¿sin internet?).", true); }
}

// Si una etiqueta se pierde o el enlace se comparte donde no debía: se cambia la clave y el QR viejo
// deja de abrir la ficha sin sesión (hay que imprimir la etiqueta otra vez).
async function regenerarEnlace(e) {
  if (soloLectura()) return;
  if (!confirm("¿Generar un enlace nuevo para este equipo?\n\nLas etiquetas QR ya impresas dejarán de abrir la ficha sin iniciar sesión y habrá que imprimir una nueva.")) return;
  const token = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data, error } = await sb.from("equipos").update({ token }).eq("id", e.id).select().single();
  if (error) { aviso(error.message, true); return; }
  guardarLocal(data);
  aviso("Enlace nuevo generado. Imprime la etiqueta otra vez.");
  verDetalle(e.id, true);
}

async function eliminarEquipo(e) {
  if (soloLectura()) return;
  if (!confirm(`¿Eliminar el equipo ${e.id} (${e.cliente || "sin cliente"}) con todas sus fotos y videos? No se puede deshacer.`)) return;
  const [f, v] = await Promise.all([
    sb.from("fotos_equipo").select("ruta").eq("equipo_id", e.id),
    sb.from("videos_equipo").select("ruta").eq("equipo_id", e.id),
  ]);
  const { error } = await sb.from("equipos").delete().eq("id", e.id);
  if (error) { aviso(error.message, true); return; }
  const rutas = [...(f.data || []), ...(v.data || [])].map((x) => x.ruta);
  if (rutas.length) await sb.storage.from(BUCKET).remove(rutas);
  equipos = equipos.filter((x) => x.id !== e.id);
  aviso("Equipo eliminado.");
  location.hash = "";
}

// ---------- Formulario ----------
function campoHTML(c, val) {
  const id = "f-" + c.k;
  const lab = `<label for="${id}" class="${c.req ? "req" : ""}">${esc(c.l)}</label>`;
  if (c.area) return `${lab}<textarea id="${id}" name="${c.k}">${esc(val)}</textarea>`;
  const lista = c.op ? ` list="dl-${c.op}"` : "";
  const dl = c.op ? `<datalist id="dl-${c.op}">${opciones(c.op).map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
  return `${lab}<input id="${id}" name="${c.k}" type="text" autocomplete="off"${lista}${c.req ? " required" : ""} value="${esc(val)}">${dl}`;
}

async function verFormulario(id) {
  mostrar("form");
  const f = $("#form-equipo");
  let e = null;
  if (id) {
    f.innerHTML = `<p class="vacio">Cargando…</p>`;
    e = await buscarEquipo(id);
    if (!e) { f.innerHTML = `<p class="vacio">No existe un equipo con ID ${esc(id)}.</p>`; return; }
  }
  $("#form-titulo").textContent = e ? `Editar equipo ${e.id}` : "Nuevo equipo";
  $("#form-volver").href = e ? "#equipo=" + encodeURIComponent(e.id) : "#";
  f.dataset.id = e ? e.id : "";
  const val = (k) => (e ? e[k] ?? "" : "");
  const estados = opciones("estado");
  const estadoActual = e ? e.estado ?? "" : (estados[0] || "");

  f.innerHTML = `
    <div class="panel grupo">
      <h2>Datos del equipo</h2>
      <div class="grid2">${GENERAL.map((c) => `<div>${campoHTML(c, val(c.k))}</div>`).join("")}</div>
    </div>

    <div class="panel grupo">
      <h2>Mediciones</h2>
      <div class="medidas-form">
        ${MEDICIONES.map(([k, l]) => `<div><label for="f-${k}">${l}</label>
          <input id="f-${k}" name="${k}" type="text" inputmode="decimal" autocomplete="off" value="${e && e[k] != null ? esc(String(e[k]).replace(".", ",")) : ""}"></div>`).join("")}
      </div>
    </div>

    <div class="panel grupo">
      <h2>Componentes</h2>
      <div class="grid2">${COMPONENTES.map((c) => `<div>${campoHTML(c, val(c.k))}</div>`).join("")}</div>
    </div>

    <div class="panel grupo">
      <h2>Proceso y estado</h2>
      ${CIERRE.map((c) => campoHTML(c, val(c.k))).join("")}
      <label for="f-estado">Estado</label>
      <select id="f-estado" name="estado">
        <option value="">(sin estado)</option>
        ${unicos([...estados, estadoActual]).map((o) => `<option${o === estadoActual ? " selected" : ""}>${esc(o)}</option>`).join("")}
      </select>
    </div>

    ${e ? "" : `
    <div class="panel grupo">
      <h2>Fotos</h2>
      <input type="file" name="fotos" accept="image/*" multiple>
      <p class="muted small" style="margin:6px 0 0">Opcional. También puedes agregar fotos y videos después, desde la ficha.</p>
    </div>`}

    <div class="guardar">
      <a class="btn" href="${$("#form-volver").getAttribute("href")}">Cancelar</a>
      <button type="submit" class="primary" id="btn-guardar">${e ? "Guardar cambios" : "Guardar equipo"}</button>
    </div>
  `;
  $("#f-cliente").focus();
}

$("#form-equipo").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (soloLectura()) return;
  const f = ev.target;
  const id = f.dataset.id;
  const datos = {};
  for (const c of TEXTO) {
    const v = (f.elements[c.k]?.value ?? "").trim();
    datos[c.k] = v === "" ? null : v;
  }
  if (!datos.cliente) { aviso("Falta el cliente.", true); $("#f-cliente").focus(); return; }
  for (const [k, l] of MEDICIONES) {
    const v = f.elements[k].value.trim().replace(",", ".");
    if (v === "") { datos[k] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n)) { aviso(`La medición ${l} no es un número.`, true); f.elements[k].focus(); return; }
    datos[k] = n;
  }

  const btn = $("#btn-guardar");
  btn.disabled = true;
  const res = id
    ? await sb.from("equipos").update(datos).eq("id", id).select().single()
    : await sb.from("equipos").insert(datos).select().single();
  if (res.error) {
    btn.disabled = false;
    aviso("No se pudo guardar: " + res.error.message, true);
    return;
  }
  guardarLocal(res.data);
  llenarFiltroEstado();
  const fotos = f.elements.fotos?.files;
  if (fotos && fotos.length) await subirArchivos(res.data.id, fotos, "foto");
  aviso(id ? "Cambios guardados." : `Equipo ${res.data.id} creado.`);
  location.hash = "equipo=" + encodeURIComponent(res.data.id);
});

// ---------- Bobinado (solo personal) ----------
// Registro de motores en bobinado: cada uno genera un QR que abre su ficha (hay que haber
// iniciado sesión como personal). La protección real está en bobinado.sql.
const CAMPOS_BOB = [
  { k: "cliente", l: "Cliente", req: true },
  { k: "encargado", l: "Encargado" },
  { k: "tipo_motor", l: "Tipo de motor" },
  { k: "volt", l: "Volt", ph: "Ej: 380" },
  { k: "kw", l: "KW", num: true, ph: "Ej: 7,5" },
  { k: "rpm", l: "RPM", num: true, ph: "Ej: 1450" },
  { k: "fecha", l: "Fecha (mes y año)", fecha: true },
];
let bobinados = [];

// La fecha del bobinado es solo mes y año (se guarda como el día 1 de ese mes).
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const fechaBob = (f) => {
  const m = String(f ?? "").match(/^(\d{4})-(\d{2})/);
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : "";
};
const mesAnioDe = (f) => {
  const m = String(f ?? "").match(/^(\d{4})-(\d{2})/);
  const hoy = new Date();
  return m ? { mes: Number(m[2]), anio: Number(m[1]) } : { mes: hoy.getMonth() + 1, anio: hoy.getFullYear() };
};
const linkBob = (b) => location.origin + location.pathname + "#bobinado=" + encodeURIComponent(b.id);
function especBob(b) {
  return [b.tipo_motor, b.volt && b.volt + " V", b.kw != null && numero(b.kw) + " KW", b.rpm != null && numero(b.rpm) + " RPM"]
    .filter(Boolean).join(" · ");
}
function opcionesBob(k) {
  const base = k === "cliente" ? opciones("cliente") : k === "tipo_motor" ? opciones("tipo_motor") : [];
  const vistos = new Map();
  for (const n of unicos([...base, ...bobinados.map((b) => b[k])])) {
    const key = normNombre(n);
    if (!vistos.has(key)) vistos.set(key, String(n).trim());
  }
  return [...vistos.values()];
}

async function cargarBobinados() {
  const { data, error } = await sb.from("bobinados").select("*").order("creado_en", { ascending: false });
  if (error) {
    aviso(error.code === "PGRST205" || error.code === "42P01"
      ? "Falta ejecutar bobinado.sql en Supabase (ver README)."
      : "Error al cargar bobinados: " + error.message, true);
    return false;
  }
  bobinados = data;
  return true;
}

function guardarBob(b) {
  const i = bobinados.findIndex((x) => x.id === b.id);
  if (i >= 0) bobinados[i] = b; else bobinados.unshift(b);
}

async function buscarBob(id) {
  const b = bobinados.find((x) => x.id === id);
  if (b) return b;
  const { data, error } = await sb.from("bobinados").select("*").eq("id", id).maybeSingle();
  if (error) { aviso(error.message, true); return null; }
  if (data) guardarBob(data);
  return data;
}

function routerBobinado(h, p) {
  if (h === "bobinado") return verListaBob();
  if (h === "bobinado-nuevo") return verFormBob(null);
  if (p.has("bobinado-editar")) return verFormBob(p.get("bobinado-editar"));
  if (p.has("bobinado")) return verFichaBob(p.get("bobinado"));
  location.hash = "bobinado";
}

// --- Lista ---
async function verListaBob() {
  mostrar("bobinado");
  renderListaBob();
  if (await cargarBobinados() && !$("#vista-bobinado").hidden) renderListaBob();
}

function renderListaBob() {
  const q = $("#buscar-bob").value.trim().toLowerCase();
  const lista = bobinados.filter((b) => !q ||
    [b.id, b.cliente, b.encargado, b.tipo_motor, b.volt].some((v) => String(v ?? "").toLowerCase().includes(q)));
  $("#conteo-bob").textContent = `${lista.length} de ${bobinados.length} bobinados`;
  $("#lista-bob").innerHTML = lista.length
    ? lista.map((b) => `
      <a class="tarjeta" href="#bobinado=${encodeURIComponent(b.id)}">
        <div class="t-top"><strong>${esc(b.cliente || "(sin cliente)")}</strong><span class="muted small">${esc(fechaBob(b.fecha))}</span></div>
        <div class="muted">${esc(especBob(b))}</div>
        <div class="muted small">ID ${esc(b.id)}${b.encargado ? " · " + esc(b.encargado) : ""}</div>
      </a>`).join("")
    : `<p class="vacio">${bobinados.length ? "No hay bobinados que coincidan." : "Todavía no hay bobinados. Toca “+ Nuevo bobinado”."}</p>`;
}
$("#buscar-bob").addEventListener("input", renderListaBob);

// --- Ficha con QR ---
async function verFichaBob(id) {
  mostrar("bobinado-ficha");
  const cont = $("#detalle-bob");
  cont.innerHTML = `<p class="vacio">Cargando…</p>`;
  const b = await buscarBob(id);
  if (!b) { cont.innerHTML = `<p class="vacio">No existe un bobinado con ID ${esc(id)}.</p>`; return; }
  const link = linkBob(b);
  const v = { ...b, fecha: fechaBob(b.fecha), kw: b.kw == null ? null : numero(b.kw), rpm: b.rpm == null ? null : numero(b.rpm) };
  cont.innerHTML = `
    <div class="panel">
      <h1 style="margin:0">${esc(b.cliente || "(sin cliente)")}</h1>
      <div class="muted">${esc(especBob(b))}</div>
    </div>

    <div class="panel qr-panel">
      <img src="${qrUrl(link)}" alt="Código QR del bobinado ${esc(b.id)}">
      <div>
        <div class="muted small">ID del bobinado</div>
        <div style="font-size:22px;font-weight:700;letter-spacing:1px;margin-bottom:8px">${esc(b.id)}</div>
        <div class="botones">
          <button type="button" id="btn-imprimir-bob" class="primary">Imprimir etiqueta QR</button>
          <button type="button" id="btn-copiar-bob">Copiar enlace</button>
        </div>
        <p class="muted small" style="margin:8px 0 0">Solo el personal que inicie sesión puede abrir este QR.</p>
      </div>
    </div>

    <div class="panel">
      <h2>Datos</h2>
      <dl class="datos">${CAMPOS_BOB.map((c) => filaDato(c, v)).join("")}</dl>
    </div>

    <div class="fila-acciones">
      <a class="btn primary" href="#bobinado-editar=${encodeURIComponent(b.id)}">Editar</a>
      <button type="button" class="peligro" id="btn-eliminar-bob">Eliminar</button>
    </div>
    <p class="muted small">Creado ${fecha(b.creado_en)} · Última modificación ${fecha(b.actualizado_en)}</p>`;
  $("#btn-imprimir-bob").onclick = () => imprimirBobinado(b);
  $("#btn-copiar-bob").onclick = async () => {
    try { await navigator.clipboard.writeText(link); aviso("Enlace copiado."); }
    catch { prompt("Copia el enlace:", link); }
  };
  $("#btn-eliminar-bob").onclick = async () => {
    if (!confirm(`¿Eliminar el bobinado ${b.id} (${b.cliente || "sin cliente"})? No se puede deshacer.`)) return;
    const { error } = await sb.from("bobinados").delete().eq("id", b.id);
    if (error) { aviso(error.message, true); return; }
    bobinados = bobinados.filter((x) => x.id !== b.id);
    aviso("Bobinado eliminado.");
    location.hash = "bobinado";
  };
}

// --- Impresión de la etiqueta ---
async function imprimirBobinado(b) {
  try {
    await enviarLocal({
      tipo: "bobinado",
      qr: linkBob(b),
      id: b.id,
      cliente: b.cliente || "",
      encargado: b.encargado || "",
      motor: b.tipo_motor || "",
      volt: b.volt || "",
      kw: b.kw == null ? "" : numero(b.kw),
      rpm: b.rpm == null ? "" : numero(b.rpm),
      fecha: fechaBob(b.fecha),
      empresa: "OMEGA ELÉCTRICA",
      copias: 1,
    });
    marcaLocal();
    aviso("Etiqueta enviada a la impresora.");
    return;
  } catch (err) {
    if (esPcTaller()) { aviso("La impresora del taller no responde. ¿Está encendida y con papel?", true); return; }
  }
  const et = $("#etiqueta");
  const src = `https://quickchart.io/qr?size=480&margin=2&ecLevel=M&dark=000000&light=ffffff&text=${encodeURIComponent(linkBob(b))}`;
  const linea = (l, v) => (v ? `<div>${l}: ${esc(v)}</div>` : "");
  et.innerHTML = `
    <div class="tit">BOBINADO</div>
    <img alt="" src="${src}">
    <div class="id">${esc(b.id)}</div>
    ${b.cliente ? `<div class="cli">${esc(b.cliente)}</div>` : ""}
    <div class="det">
      ${linea("Encargado", b.encargado)}${linea("Motor", b.tipo_motor)}${linea("Volt", b.volt)}
      ${linea("KW", b.kw == null ? "" : numero(b.kw))}${linea("RPM", b.rpm == null ? "" : numero(b.rpm))}
      ${linea("Fecha", fechaBob(b.fecha))}
    </div>
    <div class="emp">OMEGA ELÉCTRICA</div>`;
  const img = $("img", et);
  const lanzar = () => setTimeout(() => window.print(), 100);
  if (img.complete) lanzar();
  else { img.onload = lanzar; img.onerror = () => aviso("No se pudo generar el QR (¿sin internet?).", true); }
}

// --- Formulario ---
function campoBob(c, val) {
  const id = "fb-" + c.k;
  const lab = `<label for="${id}" class="${c.req ? "req" : ""}">${esc(c.l)}</label>`;
  if (c.fecha) {
    const { mes, anio } = mesAnioDe(val);
    return `<label for="fb-mes">${esc(c.l)}</label>
      <div class="grid2" style="gap:8px">
        <select id="fb-mes" name="mes">${MESES.map((n, i) => `<option value="${i + 1}"${i + 1 === mes ? " selected" : ""}>${n}</option>`).join("")}</select>
        <input id="fb-anio" name="anio" type="number" inputmode="numeric" min="2000" max="2100" step="1" value="${anio}" aria-label="Año">
      </div>`;
  }
  const lista = c.k === "cliente" || c.k === "encargado" || c.k === "tipo_motor";
  const dl = lista ? `<datalist id="dlb-${c.k}">${opcionesBob(c.k).map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
  return `${lab}<input id="${id}" name="${c.k}" type="text" autocomplete="off"${lista ? ` list="dlb-${c.k}"` : ""}` +
    `${c.num ? ' inputmode="decimal"' : ""}${c.ph ? ` placeholder="${esc(c.ph)}"` : ""}${c.req ? " required" : ""} value="${esc(val)}">${dl}`;
}

async function verFormBob(id) {
  mostrar("bobinado-form");
  const f = $("#form-bobinado");
  let b = null;
  if (id) {
    f.innerHTML = `<p class="vacio">Cargando…</p>`;
    b = await buscarBob(id);
    if (!b) { f.innerHTML = `<p class="vacio">No existe un bobinado con ID ${esc(id)}.</p>`; return; }
  } else if (!bobinados.length) {
    await cargarBobinados(); // para sugerir clientes y encargados ya usados
  }
  $("#form-bob-titulo").textContent = b ? `Editar bobinado ${b.id}` : "Nuevo bobinado";
  const volver = b ? "#bobinado=" + encodeURIComponent(b.id) : "#bobinado";
  $("#form-bob-volver").href = volver;
  f.dataset.id = b ? b.id : "";
  const val = (c) => {
    if (!b) return "";
    const v = b[c.k];
    return v == null ? "" : c.num ? String(v).replace(".", ",") : v;
  };
  f.innerHTML = `
    <div class="panel grupo">
      <div class="grid2">${CAMPOS_BOB.map((c) => `<div>${campoBob(c, val(c))}</div>`).join("")}</div>
    </div>
    <div class="guardar">
      <a class="btn" href="${volver}">Cancelar</a>
      <button type="submit" class="primary" id="btn-guardar-bob">${b ? "Guardar cambios" : "Guardar y crear QR"}</button>
    </div>`;
  $("#fb-cliente").focus();
}

$("#form-bobinado").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (soloLectura()) return;
  const f = ev.target;
  const id = f.dataset.id;
  const datos = {};
  for (const c of CAMPOS_BOB) {
    if (c.fecha) {
      const anio = Number(f.elements.anio.value);
      if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) { aviso("El año no es válido.", true); f.elements.anio.focus(); return; }
      datos.fecha = `${anio}-${String(f.elements.mes.value).padStart(2, "0")}-01`;
      continue;
    }
    const v = (f.elements[c.k]?.value ?? "").trim();
    if (c.req && !v) { aviso(`Falta ${c.l.toLowerCase()}.`, true); f.elements[c.k].focus(); return; }
    if (c.num && v) {
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) { aviso(`${c.l} no es un número válido.`, true); f.elements[c.k].focus(); return; }
      datos[c.k] = n;
    } else {
      datos[c.k] = v === "" ? null : v;
    }
  }
  const btn = $("#btn-guardar-bob");
  btn.disabled = true;
  const res = id
    ? await sb.from("bobinados").update(datos).eq("id", id).select().single()
    : await sb.from("bobinados").insert(datos).select().single();
  if (res.error) {
    btn.disabled = false;
    aviso("No se pudo guardar: " + res.error.message, true);
    return;
  }
  guardarBob(res.data);
  aviso(id ? "Cambios guardados." : `Bobinado ${res.data.id} creado.`);
  location.hash = "bobinado=" + encodeURIComponent(res.data.id);
});

// ---------- Escáner ----------
function extraerId(texto) {
  const t = String(texto).trim();
  const m = t.match(/[#&?](?:equipo|row)=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : t;
}

async function verEscaner() {
  mostrar("escaner");
  if (!window.Html5Qrcode) { aviso("No se pudo cargar el lector de QR. Revisa la conexión.", true); return; }
  await detenerEscaner();
  const lector = new Html5Qrcode("lector");
  escaner = lector;
  try {
    await lector.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, (texto) => {
      if (escaner !== lector) return;
      const bob = String(texto).match(/[#&?]bobinado=([^&]+)/);
      const destino = bob ? "bobinado=" + bob[1] : "equipo=" + encodeURIComponent(extraerId(texto));
      detenerEscaner().then(() => { location.hash = destino; });
    });
  } catch (err) {
    if (escaner === lector) escaner = null;
    aviso("No se pudo abrir la cámara. Revisa que la página tenga permiso de cámara.", true);
  }
}

async function detenerEscaner() {
  if (!escaner) return;
  const e = escaner;
  escaner = null;
  try { await e.stop(); } catch {}
  try { e.clear(); } catch {}
}

// ---------- Exportar CSV ----------
$("#btn-csv").addEventListener("click", () => {
  const cols = [
    ["id", "ID_Equipo"], ["cliente", "Cliente"], ["tipo_motor", "Tipo_de_motor"], ["tipo_voltaje", "Tipo_de_Voltaje"],
    ["tipo_mantenimiento", "Tipo_de_Mantenimiento"], ["encargados", "Encargado/s"],
    ...MEDICIONES.map(([k]) => [k, k.toUpperCase()]),
    ["rodamientos", "Rodamientos"], ["sello", "Sello"], ["reten", "Reten"], ["placa_bornera", "Placa_Bornera"],
    ["proceso", "Proceso"], ["notas", "Notas_Adicionales"], ["estado", "Estado"],
    ["creado_en", "Creado"], ["actualizado_en", "Modificado"],
  ];
  const celda = (v) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const filas = [cols.map((c) => c[1]).join(";"), ...equipos.map((e) => cols.map(([k]) => celda(e[k])).join(";"))];
  const blob = new Blob(["﻿" + filas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `equipos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// ---------- Instalar como app ----------
let pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  pedidoInstalar = ev;
  $("#btn-instalar").hidden = false;
});
$("#btn-instalar").addEventListener("click", async () => {
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt();
  await pedidoInstalar.userChoice;
  pedidoInstalar = null;
  $("#btn-instalar").hidden = true;
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// ---------- Arranque ----------
if (!CFG.SUPABASE_URL.includes("TU-PROYECTO") && !CFG.SUPABASE_ANON_KEY.includes("TU-ANON")) {
  iniciar();
} else {
  document.body.innerHTML = `<div class="caja" style="margin:40px auto">
    <h1>Falta configurar</h1>
    <p>Abre <code>config.js</code> y pega la URL y la clave <b>anon public</b> de tu proyecto Supabase.</p></div>`;
}
