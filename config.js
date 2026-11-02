// Pega aquí los datos de tu proyecto Supabase
// (Supabase → Project Settings → API)
window.CONFIG = {
  SUPABASE_URL: "https://jbrvrbpouxqmdcbbwaga.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_OeTNI_ADsfBw-kDqp6bDUg_uT9opZ2S",

  // Opciones que aparecen como sugerencias en el formulario.
  // Puedes agregar, quitar o cambiar las que quieras.
  // (En los campos con sugerencias igual se puede escribir otro valor.)
  OPCIONES: {
    tipo_motor: ["Motor con polea", "Bomba de agua", "Bomba multietapa", "Motor trifásico", "Motor monofásico"],
    tipo_mantenimiento: ["Mantenimiento Correctivo", "Mantenimiento Preventivo", "Rebobinado"],
    rodamientos: ["Delantero", "Trasero", "Delantero y trasero", "Extra"],
    // Estado se elige de esta lista (también sirve para filtrar).
    estado: ["Pendiente", "En mantención", "Terminado", "Entregado"],
  },
};
