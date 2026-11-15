import { NextResponse } from "next/server";
import { exigir } from "@/lib/roles-servidor";
import {
  MAX_BYTES_PDF,
  MAX_PAGINAS_PDF,
  aCsv,
  contarPaginas,
  normalizar,
  verificar,
} from "@/lib/pdfExtracto";
import { leerPdfConIa } from "@/lib/pdfExtracto-servidor";

/**
 * POST /api/extracto/leer-pdf — un estado de cuenta en PDF → CSV de movimientos.
 *
 * No importa nada: devuelve el CSV y la verificación, y el wizard lo trata como
 * cualquier extracto en CSV (mapeo, saldo final, /api/extracto/importar). Así
 * no hay un segundo camino de importación que mantener, y el usuario ve lo que
 * se leyó antes de confirmar.
 *
 * ⚠️ Recibe un archivo: excluida del middleware (src/middleware.ts), que
 * trunca en silencio los cuerpos de más de 10 MB.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const acceso = await exigir("cargar");
  if (!acceso.ok) return NextResponse.json({ error: acceso.error }, { status: acceso.status });

  const form = await request.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Falta el PDF del extracto." }, { status: 400 });
  }
  if (!archivo.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "El archivo no es un PDF." }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES_PDF) {
    return NextResponse.json(
      { error: `El PDF pesa más de ${MAX_BYTES_PDF / 1024 / 1024} MB. Descarga el extracto en Excel o CSV desde la banca por internet.` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const paginas = contarPaginas(bytes);
  if (paginas > MAX_PAGINAS_PDF) {
    return NextResponse.json(
      {
        error: `El PDF tiene ${paginas.toLocaleString("es-PE")} páginas y la lectura con IA admite hasta ${MAX_PAGINAS_PDF}. Para un extracto así de grande, descárgalo en Excel o CSV desde la banca por internet.`,
      },
      { status: 413 },
    );
  }

  const r = await leerPdfConIa(bytes, archivo.name);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });

  const filas = normalizar(r.lectura);
  if (filas.length === 0) {
    return NextResponse.json(
      { error: r.lectura.advertencia || "No se encontraron movimientos en el PDF. ¿Es un estado de cuenta bancario?" },
      { status: 422 },
    );
  }

  return NextResponse.json({
    csv: aCsv(filas),
    nombre: archivo.name.replace(/\.pdf$/i, ".csv"),
    movimientos: filas.length,
    paginas,
    saldoInicial: r.lectura.saldo_inicial ?? null,
    saldoFinal: r.lectura.saldo_final ?? null,
    verificacion: verificar(filas, r.lectura.saldo_inicial, r.lectura.saldo_final),
    advertencia: r.lectura.advertencia ?? null,
  });
}
