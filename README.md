# Agente personal contable (MVP)

Monorepo con **Next.js**, **Supabase**, **LangGraph** y **OpenRouter**. Incluye chat web, onboarding, ajustes y bot de **Telegram** (opcional).

El agente soporta un flujo inicial de **contabilidad asistida**: puede conectarse a **Google Drive** para listar y leer archivos, extraer campos de facturas (por ejemplo **NIT**, razón social, número, fecha y total) y registrar filas en **Google Sheets** con confirmación humana cuando la acción implica escritura. Esto lo hace por medio de **Google Cloud Console**

## Requisitos previos

- **Node.js** 20 o superior (recomendado LTS).
- **npm** 10+ (incluido con Node.js 20+).
- Cuenta en **[Supabase](https://supabase.com)** (gratis).
- Cuenta en **[OpenRouter](https://openrouter.ai)** para la API del modelo (clave de API).
- *(Opcional)* Bot de Telegram creado con [@BotFather](https://t.me/BotFather) y una URL **HTTPS** pública para el webhook (en local suele usarse **ngrok** o similar).

---

## Paso 1 — Clonar e instalar dependencias

Desde la **raíz del monorepo** (esta carpeta del repo):

```bash
npm install
```

---

## Paso 2 — Crear proyecto en Supabase

1. Entra en el [dashboard de Supabase](https://supabase.com/dashboard) y crea un **nuevo proyecto**.
2. Espera a que termine el aprovisionamiento.
3. En **Project Settings → API** anota:
   - **Project URL** → será `NEXT_PUBLIC_SUPABASE_URL`
   - **`anon` public** → será `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **`service_role` secret** → será `SUPABASE_SERVICE_ROLE_KEY` (no la expongas al cliente ni la subas a repositorios públicos).

---

## Paso 3 — Aplicar el esquema SQL (tablas + RLS)

1. En Supabase, abre **SQL Editor**.
2. Abre el archivo del repo:

   `packages/db/supabase/migrations/00001_initial_schema.sql`

3. Copia **todo** el contenido y pégalo en el editor.
4. Ejecuta el script (**Run**).

Si algo falla (por ejemplo, el trigger `on_auth_user_created` en un proyecto ya modificado), revisa el mensaje de error; en la mayoría de proyectos nuevos el script aplica de una vez.

---

## Paso 4 — Configurar autenticación (email)

1. En Supabase: **Authentication → Providers** → habilita **Email** (por defecto suele estar activo).
2. **Authentication → URL configuration**:
   - **Site URL**: para desarrollo local usa `http://localhost:3000`
   - **Redirect URLs**: añade al menos:
     - `http://localhost:3000/auth/callback`
     - `http://localhost:3000/**` (o la variante que permita tu versión del dashboard para desarrollo)

Así el flujo de login/signup y el intercambio de código en `/auth/callback` funcionan en local.

---

## Paso 5 — Variables de entorno

Next.js carga `.env*` desde el directorio de la app **`apps/web`**, no desde la raíz del monorepo.

1. Copia el ejemplo:

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```

   *(Las variables se leen desde `apps/web`, no desde la raíz del monorepo.)*

2. Edita `apps/web/.env.local` y completa:

   | Variable | Descripción |
   |----------|-------------|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave `anon` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role` (solo servidor; la usa la API del agente y Telegram contra Postgres) |
   | `OPENROUTER_API_KEY` | Clave de OpenRouter |
   | `TELEGRAM_BOT_TOKEN` | *(Opcional)* Token del bot (BotFather) |
   | `TELEGRAM_WEBHOOK_BASE_URL` | *(Opcional)* Origen HTTPS público del webhook, p. ej. `https://xxxx.ngrok-free.app` (sin barra final). Facilita registrar el webhook en local |
   | `TELEGRAM_WEBHOOK_SECRET` | *(Opcional)* Secreto; si lo defines, debe ser el mismo al llamar `/api/telegram/setup` (tras cambiarlo, vuelve a abrir esa URL) |
   | `DATABASE_URL` | URI Postgres directa (LangGraph); en Supabase Cloud suele ser la del **Session pooler** |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Para OAuth Google (Drive/Sheets); `GOOGLE_REDIRECT_URI` debe ser **idéntica** a una URI autorizada en Google Cloud (`…/api/integrations/google/callback`). En Railway usa la URL pública HTTPS del despliegue, no `localhost`. |
   | `OAUTH_ENCRYPTION_KEY` | Cadena hex de **64 caracteres** (32 bytes); cifra tokens OAuth en base de datos. Sin esto, GitHub/Google fallan al guardar o leer tokens |

Referencia de nombres: [apps/web/.env.example](apps/web/.env.example).

---

## Paso 6 — Arrancar la aplicación web

Desde la **raíz** del repo:

```bash
npm run dev
```

Por defecto Turbo ejecuta el `dev` de cada paquete; la app suele quedar en **http://localhost:3000**.

Flujo esperado:

1. **Registro** en `/signup` o **login** en `/login`.
2. **Onboarding** (perfil, agente, herramientas, revisión).
3. **Chat** en `/chat` y **ajustes** en `/settings`.

---

## Paso 7 — Probar el chat con el modelo

1. Confirma que `OPENROUTER_API_KEY` está en `apps/web/.env.local`.
2. En el onboarding, activa al menos las herramientas básicas (`get_user_preferences`, `list_enabled_tools`) si quieres probar *tool calling*.
3. Escribe un mensaje en `/chat`. Si la clave o el modelo fallan, revisa la consola del servidor (terminal donde corre `npm run dev`).

El modelo por defecto está definido en `packages/agent/src/model.ts` (OpenRouter, `openai/gpt-4o-mini`). Puedes cambiarlo ahí si lo necesitas.

---

## Paso 8 — Telegram (opcional)

Telegram **exige HTTPS** para webhooks. En local:

1. Crea el bot con BotFather y copia el token → `TELEGRAM_BOT_TOKEN` en `apps/web/.env.local`.
2. Elige un secreto aleatorio → `TELEGRAM_WEBHOOK_SECRET` (mismo valor usarás al registrar el webhook).
3. Expón tu app local con un túnel HTTPS, por ejemplo:

   ```bash
   ngrok http 3000
   ```

   Usa la URL HTTPS que te dé ngrok (p. ej. `https://abc123.ngrok-free.app`).

4. Con la app en marcha, visita en el navegador (sustituye la URL base):

   `https://TU_URL_NGROK/api/telegram/setup`

   Eso llama a `setWebhook` de Telegram apuntando a `/api/telegram/webhook` y, si definiste secreto, lo asocia al webhook.

5. En la web, entra a **Ajustes** → **Telegram** → **Generar código de vinculación**.
6. En Telegram, envía al bot: `/link TU_CODIGO` (el código que te muestra la web).

Después de vincular, los mensajes al bot usan el mismo pipeline que el chat web.

---

## Comandos útiles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Desarrollo (monorepo) |
| `npm run build` | Build de todos los paquetes que definan `build` |
| `npm run lint` | Lint |
| `cd apps/web && npx next build` | Build solo de la app Next (útil para comprobar tipos antes de desplegar) |

---

## Documentación adicional

- [docs/brief.md](docs/brief.md) — visión y brief original.
- [docs/architecture.md](docs/architecture.md) — arquitectura técnica del MVP.
- [docs/plan.md](docs/plan.md) — fases y decisiones de implementación.

---

## Problemas frecuentes

- **Redirecciones infinitas o “no auth”**: revisa `Site URL` y `Redirect URLs` en Supabase y que `.env.local` esté en **`apps/web`**.
- **Errores al guardar perfil o mensajes**: confirma que ejecutaste la migración SQL y que RLS no bloquea por falta de sesión (debes estar logueado con el mismo usuario).
- **Chat sin respuesta / 500 en `/api/chat`**: `OPENROUTER_API_KEY`, cuota en OpenRouter o modelo en `model.ts`.
- **Telegram no responde**: el webhook debe ser HTTPS; revisa `TELEGRAM_BOT_TOKEN` y, si usas secreto, que coincida con el registrado. **Cada vez que cambia la URL de ngrok**, actualiza `TELEGRAM_WEBHOOK_BASE_URL` y vuelve a abrir `https://TU_URL_NGROK/api/telegram/setup`.
- **Google Drive / Sheets deja de funcionar** o en consola aparece `invalid_grant` / “Token has been expired or revoked”: el refresh token ya no vale. Ve a **Ajustes → desconectar Google y volver a conectar** (OAuth completo). Confirma `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y que `GOOGLE_REDIRECT_URI` coincide con Google Cloud.

Si quieres, el siguiente paso natural es desplegar **Vercel** (o similar) para `apps/web`, definir las mismas variables de entorno en el panel del proveedor y usar la URL de producción en Supabase y en el webhook de Telegram.

---

## Checklist al volver a abrir el proyecto

Úsalo cuando reinicies la PC o lleves tiempo sin tocar el repo; no hace falta repetir migraciones SQL cada día.

| Orden | Qué hacer |
|-------|-----------|
| 1 | **Raíz del repo:** `npm run dev` → app en [http://localhost:3000](http://localhost:3000). |
| 2 | **Supabase en la nube:** nada extra. **Supabase local:** arranca antes tu stack (`npx supabase start` u orden habitual). |
| 3 | **Telegram (opcional):** otra terminal → `ngrok http 3000`. Copia la URL `https://…`, ponla en `apps/web/.env.local` como `TELEGRAM_WEBHOOK_BASE_URL` (sin `/` al final). Si editaste `.env.local`, **reinicia** `npm run dev`. Abre `https://TU_URL_NGROK/api/telegram/setup` una vez. Si es otro usuario o borraste datos, en el bot: `/link CODIGO` (código desde **Ajustes** en la web). |
| 4 | **Google:** con `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` el servidor puede **renovar** el access token. Si ves error de token revocado o Drive no responde: **Ajustes → reconectar Google**. |
| 5 | **Misma cuenta web y Telegram:** el bot usa el `user_id` de quien generó el código de `/link`; conecta Google estando logueado en esa misma cuenta. |

### Comandos mínimos (referencia)

```bash
# Terminal 1 — raíz del monorepo
npm run dev

# Terminal 2 — solo si usas Telegram en local
ngrok http 3000
```

- Sin Telegram, basta con el paso 1 (y Supabase si aplica).
- No subas `apps/web/.env.local` al repositorio.
