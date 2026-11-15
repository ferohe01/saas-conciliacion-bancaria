# Activar el SSO corporativo (SAML) en el Supabase self-hosted

> ⚠️ **Hoy el SSO está DESACTIVADO a propósito** (`SSO_ACTIVO = false` en
> `src/lib/sso.ts`, decisión del 15/11/2026). El sistema se vende también a
> PyMEs, que no tienen proveedor de identidad corporativo, y el botón solo las
> confundía. Está implementado y con tests: se activará cuando una empresa
> grande lo solicite. **Paso 0:** poner `SSO_ACTIVO = true` y desplegar; luego
> seguir esta guía.

La aplicación ya trae todo lo suyo: el botón «Ingresar con el SSO de mi empresa»
en el login, el alta automática por dominio (`/auth/callback`, migración `0058`)
y el registro del proveedor desde **/usuarios → Acceso corporativo (SSO)**.

Lo que falta se hace **una vez, en el servidor**: activar SAML en el servicio de
autenticación de Supabase (GoTrue) y dejar pasar por Kong las dos rutas que el
proveedor de identidad llama sin `apikey`. Sin esto, registrar un proveedor en
/usuarios responde «El acceso corporativo (SAML) no está activado».

## 1. Clave privada de firma SAML

En el VPS (o en cualquier equipo con OpenSSL):

```bash
openssl genrsa -out saml_private_key.pem 2048
openssl rsa -in saml_private_key.pem -outform DER | base64 -w0 > saml_private_key.b64
```

`saml_private_key.b64` es el valor de `GOTRUE_SAML_PRIVATE_KEY`. ⚠️ Es un
secreto: no lo subas al repositorio y borra los dos archivos tras copiarlo.

## 2. Variables del servicio `auth` (Dokploy → Supabase → Environment)

```
GOTRUE_SAML_ENABLED=true
GOTRUE_SAML_PRIVATE_KEY=<contenido de saml_private_key.b64>
```

Y en la lista de redirecciones permitidas, la vuelta del SSO a la app:

```
ADDITIONAL_REDIRECT_URLS=https://conciliacion.fernandorh.com/auth/callback
```

(Si la variable ya tiene valores, añade este separado por comas.)

## 3. Kong: abrir las rutas SAML

En el `kong.yml` del Supabase self-hosted, `/auth/v1/` exige `apikey`. El
proveedor de identidad hace un POST a `/auth/v1/sso/saml/acs` **sin `apikey`**,
y lo bloquearía: el usuario volvería del login corporativo a un error 401 sin
explicación. Añade junto a los demás servicios `auth-v1-open-*`:

```yaml
  - name: auth-v1-open-sso-acs
    url: http://auth:9999/sso/saml/acs
    routes:
      - name: auth-v1-open-sso-acs
        strip_path: true
        paths:
          - /auth/v1/sso/saml/acs
    plugins:
      - name: cors
  - name: auth-v1-open-sso-metadata
    url: http://auth:9999/sso/saml/metadata
    routes:
      - name: auth-v1-open-sso-metadata
        strip_path: true
        paths:
          - /auth/v1/sso/saml/metadata
    plugins:
      - name: cors
```

## 4. Reiniciar Supabase

Redeploy del compose de Supabase en Dokploy. Comprobación rápida:

```bash
curl -s https://supabase.fernandorh.com/auth/v1/sso/saml/metadata | head -c 200
```

Debe devolver XML (`<EntityDescriptor …`). Un 401 = falta el paso 3; un 404 con
«SAML 2.0 is disabled» = falta el paso 2.

## 5. Dar de alta una empresa cliente

Lo hace el administrador de esa empresa en **/usuarios → Acceso corporativo
(SSO)**, sin tocar el servidor:

1. Crea en su proveedor de identidad (Entra ID, Okta, Google Workspace…) una
   aplicación SAML con los datos que muestra la pantalla: *Entity ID*, *URL de
   respuesta (ACS)*. Identificador del usuario (NameID): su correo.
2. Pega en /usuarios el dominio de correo (`empresa.com.pe`), la URL de
   metadatos SAML que le da su proveedor y el rol con que entra la gente.

A partir de ahí, su equipo entra con «Ingresar con el SSO de mi empresa».

## Seguridad: por qué el alta automática no se fía solo del dominio

Quien entra por primera vez se da de alta en la empresa **solo si su sesión vino
del proveedor SAML de esa empresa** (`app_metadata.provider = sso:<id>`), no por
tener un correo `@empresa.com.pe`. Si bastara el dominio, cualquiera podría
registrarse con contraseña usando ese correo, sin que la empresa lo verificara.
Ver `altaPorSso` en `src/lib/sso.ts` y sus tests.
