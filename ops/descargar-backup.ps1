# ============================================================================
# descargar-backup.ps1 - trae el backup mas reciente del VPS a este PC.
#
# Tercera copia, independiente del VPS y de la cuenta de Contabo. Pensado para
# ejecutarse desde el Programador de tareas de Windows (semanal).
#
# Verifica el MD5 tras la descarga: un fichero a medias parece un backup y no
# lo es.
#
# NOTA: fichero en ASCII puro a proposito. Windows PowerShell 5.1 lee los .ps1
# como ANSI si no llevan BOM, y cualquier caracter no-ASCII rompe el parseo.
# ============================================================================
$ErrorActionPreference = 'Stop'

# --- Configuracion ----------------------------------------------------------
$VPS     = 'root@95.111.245.187'
$REMOTO  = '/opt/backups/supabase'
$DESTINO = 'C:\backups_conciliacion'
$COPIAS  = 8                       # cuantas descargas conservar aqui
$LOG     = Join-Path $DESTINO 'descargas.log'

function Registrar($mensaje) {
    $linea = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $mensaje
    Add-Content -Path $LOG -Value $linea -Encoding utf8
}

try {
    if (-not (Test-Path $DESTINO)) {
        New-Item -ItemType Directory -Path $DESTINO -Force | Out-Null
    }
    Registrar '----- inicio'

    # --- 1. Que fichero es el mas reciente en el VPS -------------------------
    $ultimo = (ssh -o BatchMode=yes $VPS "ls -t $REMOTO/*.sql.gz | head -1")
    if ($LASTEXITCODE -ne 0) { throw "no se pudo conectar al VPS (codigo $LASTEXITCODE)" }
    $ultimo = "$ultimo".Trim()
    if ([string]::IsNullOrWhiteSpace($ultimo)) { throw 'el VPS no devolvio ningun backup' }

    $nombre = ($ultimo -split '/')[-1]
    $local  = Join-Path $DESTINO $nombre

    if (Test-Path $local) {
        Registrar "ya estaba descargado: $nombre - nada que hacer"
        Registrar '----- fin OK'
        exit 0
    }

    # --- 2. Huella en origen, antes de copiar --------------------------------
    $md5remoto = ((ssh -o BatchMode=yes $VPS "md5sum $ultimo") -split '\s+')[0]
    if ($LASTEXITCODE -ne 0) { throw 'no se pudo calcular el md5 en el VPS' }

    # --- 3. Descargar --------------------------------------------------------
    Registrar "descargando $nombre"
    scp -o BatchMode=yes "${VPS}:$ultimo" $local
    if ($LASTEXITCODE -ne 0) { throw "scp fallo (codigo $LASTEXITCODE)" }

    # --- 4. Verificar que llego integro --------------------------------------
    $md5local = (Get-FileHash -Algorithm MD5 -Path $local).Hash
    if ($md5local -ine $md5remoto) {
        Remove-Item $local -Force
        throw "el MD5 no coincide (origen $md5remoto / local $md5local) - descarga descartada"
    }
    $tam = [math]::Round((Get-Item $local).Length / 1KB)
    Registrar "OK: $nombre ($tam KB) md5 verificado"

    # --- 5. Rotacion local ---------------------------------------------------
    $sobran = Get-ChildItem "$DESTINO\supabase-*.sql.gz" |
              Sort-Object LastWriteTime -Descending |
              Select-Object -Skip $COPIAS
    foreach ($f in $sobran) {
        Remove-Item $f.FullName -Force
        Registrar "rotado (eliminado): $($f.Name)"
    }

    $n = (Get-ChildItem "$DESTINO\supabase-*.sql.gz").Count
    Registrar "copias locales: $n"
    Registrar '----- fin OK'
}
catch {
    Registrar "FALLO: $($_.Exception.Message)"
    exit 1
}
