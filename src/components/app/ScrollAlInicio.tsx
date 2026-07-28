"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Lleva el scroll al inicio al cambiar de ruta.
 *
 * Por qué existe: al venir de una pantalla alta (el registro con sus dos
 * fichas, un historial largo) el navegador podía conservar la posición de
 * scroll y dejarte mirando el vacío de debajo de una página corta — parecía que
 * la pantalla se había quedado en blanco.
 *
 * Dos excepciones deliberadas, porque un "scroll al inicio" a lo bruto rompe
 * cosas que sí funcionaban:
 *
 *  - **Atrás / adelante del navegador**: ahí el usuario espera volver justo
 *    donde estaba. Se detecta con `popstate` y se salta ese reseteo.
 *  - **Enlaces con ancla** (`#seccion`): el destino es un punto concreto de la
 *    página, no su principio.
 */
export function ScrollAlInicio() {
  const pathname = usePathname();
  const volviendo = useRef(false);

  useEffect(() => {
    const alVolver = () => {
      volviendo.current = true;
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);

  useEffect(() => {
    if (volviendo.current) {
      volviendo.current = false;
      return;
    }
    if (window.location.hash) return;
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
