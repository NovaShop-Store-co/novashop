# NovaShop

Tienda estática con catálogo, carrito, una página de Streaming, cuentas opcionales y pedidos registrados en Supabase.

## Tecnologías

- HTML, CSS y JavaScript estáticos.
- GitHub para guardar el código.
- Supabase Auth + Postgres para cuentas, perfiles y el historial de pedidos.
- Supabase Edge Function `create-order` para guardar pedidos y calcular importes desde el catálogo del servidor.
- Los clientes pueden comprar como invitados; las cuentas son opcionales.

## Archivos principales

- `index.html`: catálogo general.
- `streaming.html`: catálogo de servicios digitales.
- `producto.html?id=<id>`: detalles individuales.
- `cuenta.html`: registro, inicio de sesión, perfil e historial.
- `products.js`: catálogo visible del sitio.
- `supabase-config.js`: solo URL y clave publicable del proyecto.
- `supabase-client.js`: cliente público e integración con la función de pedidos.
- `supabase/`: configuración documentada.

## Seguridad

No se debe publicar ninguna clave secreta ni `service_role`. La clave publishable está diseñada para usarse desde el navegador; las tablas públicas tienen RLS. La función `create-order` valida productos y precios en el servidor. Las compras de invitados se guardan sin asociarse a una cuenta y no se vinculan automáticamente después.

## Estado de pagos

El checkout ofrece pago en línea con Bold o contraentrega para productos físicos. Bold tiene envío gratis; contraentrega mantiene el pago del producto pendiente hasta la entrega y exige cotizar y pagar el flete por anticipado a la transportadora. El webhook/consulta de Bold marca el pago en línea como aprobado solo cuando se verifica la transacción. Las llaves del comercio y la configuración del webhook son necesarias antes de aceptar pagos reales.

## Supabase Auth

En el panel de Supabase, configura Site URL y Redirect URLs con el dominio publicado del sitio, incluyendo `cuenta.html`, para que funcionen confirmación de correo y recuperación de contraseña.


## Accounts and address verification

The account page supports passwordless one-time codes. Email OTP requires Supabase Auth email configuration and the Magic Link/OTP template to use `{{ .Token }}`; a production SMTP sender is recommended. SMS OTP requires enabling Phone Auth and configuring a supported SMS provider in Supabase. SMS providers may charge per message.

The signup form collects first/last name, phone, email, a written delivery address and an optional saved map pin. Every checkout containing physical products requires valid latitude and longitude; the storefront checks this before submission and the `create-order` Edge Function also rejects physical orders without coordinates. The written street address, neighborhood, city and department remain required and are not replaced by the map pin.

## Administrator product catalog

- Admin UI: `admin.html`
- Admin browser script: `admin.js`
- Edge Function: `supabase/functions/admin-products/index.ts`
- Media bucket: `products-media` (public-read media; uploads require admin authorization)
- Schema additions: `supabase/schema.sql`

### Grant the first admin

Security by design: the first account is **not** automatically made an administrator. After creating and verifying your own account in `cuenta.html`, open Supabase > Authentication > Users and copy your user UUID. Then run in SQL Editor:

```sql
insert into public.store_admins (user_id)
values ('PASTE-YOUR-USER-UUID-HERE')
on conflict (user_id) do nothing;
```

Replace the example text with your own verified account UUID. Never give this role to customer accounts. Then open `admin.html`; the server checks this allowlist before listing, editing, hiding, or uploading product media.

## Current payment status

NovaShop has a Bold custom checkout integration in place. Orders are created on the server and start as `pending_payment`. Customers can select Bold from the cart or product page; payment methods available inside Bold depend on the merchant's enabled methods. Bold payments have free shipping. Physical-product COD orders keep product payment pending until delivery and require the carrier's freight amount to be quoted and prepaid before the order can be marked shipped. The checkout signature is generated server-side; the return page queries Bold's transaction API and a separate Edge Function validates Bold webhook signatures and transaction amounts before updating an order. Real payments require the merchant's own Bold integration keys and production webhook registration. Do not dispatch orders solely because the customer returns to the store.


## Admin panel de productos

- Panel: `admin.html`
- Función segura: `supabase/functions/admin-products/index.ts`
- El servidor comprueba que el usuario autenticado esté en `public.store_admins`.
- Para conceder acceso, crea primero la cuenta de usuario y ejecuta un `INSERT INTO public.store_admins (user_id)` usando el UUID de esa cuenta desde el SQL Editor privado de Supabase. No abras permisos de escritura directos en la tabla a usuarios normales.
- El panel está organizado por secciones (resumen, ventas/pedidos, catálogo/inventario, promociones, reseñas y usuarios/roles).
- Permite cargar hasta 8 fotos (12 MB cada una) y un video de producto (MP4 recomendado, WEBM o MOV; máximo 50 MB) al bucket `products-media`, editar nombre, descripción, categoría, precio y ocultar productos.
- La ficha del producto muestra el video en un reproductor adaptable 16:9 estilo tienda de videojuegos. El archivo se guarda tal como se sube: no se realiza transcodificación automática; MP4 con H.264 ofrece la compatibilidad más amplia.


## Registro y acceso v16

- `cuenta.html`: registro en dos pasos; contacto/contraseña y después dirección/mapa.
- `verificar.html`: una única pantalla para introducir el código enviado por Supabase Auth.
- `verify.js`: valida el OTP y guarda el perfil/dirección sin almacenar la contraseña en sessionStorage.
- `auth-login`: Edge Function permite iniciar sesión con correo o teléfono y contraseña. Supabase Auth valida la contraseña y la función solo devuelve tokens con credenciales correctas.
- `profiles.marketing_opt_in`: consentimiento opcional independiente para recibir ofertas por correo.
- El envío por correo utiliza el proveedor de correo de Supabase. El envío por SMS necesita proveedor de SMS; WhatsApp requiere configurar Twilio/Twilio Verify con canal WhatsApp y credenciales. No se simula un envío WhatsApp mientras no esté configurado.


## Administración de stock y ventas

- El panel privado calcula ingresos y porcentajes solo a partir de pedidos con pago confirmado.
- `products.stock_quantity`: entero no negativo; `NULL` significa inventario aún no configurado y `0` significa agotado.
- Los productos existentes quedan con stock sin configurar porque no se proporcionó una cantidad real para ellos.
- Los pedidos con `payment_status` distinto de `approved` no se consideran ventas pagadas. Los pedidos COD solo pasan a pago aprobado cuando el producto se marca recibido/pagado; el flete prepagado se administra por separado.
- El acceso a métricas y administración se comprueba en la Edge Function `admin-products` contra `public.store_admins`.


# NovaShop — arreglar el código de confirmación de correo

## 1. Corregir el error de localhost
En Supabase abre **Authentication → URL Configuration**.

Configura:
- **Site URL:** `https://adrianmarin05.github.io/novashop`
- **Redirect URLs:**
  - `https://adrianmarin05.github.io/novashop/verificar.html`
  - `https://adrianmarin05.github.io/novashop/cuenta.html`

Guarda los cambios. No uses localhost para el sitio publicado.

## 2. Cambiar el mensaje de confirmación a un código
En Supabase abre **Authentication → Email Templates → Confirm signup**. Ahora el template predeterminado puede enviar un enlace mediante `{{ .ConfirmationURL }}`. Para enviar un código numérico, reemplaza el contenido por:

```html
<h2>Confirma tu cuenta NovaShop</h2>
<p>Tu código de verificación de un solo uso es:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Introduce este código en la página de verificación de NovaShop. Si no solicitaste esta cuenta, ignora este mensaje.</p>
```

Guarda la plantilla y vuelve a intentar con un correo que no esté registrado previamente. El código lo genera Supabase Auth; NovaShop no debe generarlo ni inventar uno manualmente.

## 3. WhatsApp
La opción de verificación por WhatsApp está inactiva hasta conectar Twilio/Twilio Verify con canal WhatsApp. La autenticación por correo no necesita esa integración. No actives el canal WhatsApp hasta que las credenciales del proveedor estén configuradas.


## Seguridad administrativa

El panel administrativo está protegido por roles validados en el servidor. No guardes credenciales ni contraseñas en este repositorio. El acceso y la asignación de roles se realizan desde Supabase y el panel privado.


## Recuperación de contraseña
`restablecer.html` orienta al cliente a contactar el WhatsApp de NovaShop (+57 300 335 8382); la página no solicita ni envía enlaces de recuperación. Después de verificar al cliente, el propietario puede establecer una contraseña temporal desde **admin.html → Usuarios registrados**. El backend comprueba el rol `owner`, rechaza cambios a la cuenta propietaria y solo cambia la contraseña mediante la API administrativa de Supabase del lado del servidor. No publiques claves de servicio ni compartas contraseñas temporalmente fuera de un chat privado.

## Pedidos e inventario — Fase 1
- El panel `admin.html` incluye un módulo privado para listar los pedidos registrados en Supabase, buscar por número/datos del cliente, filtrar por estado y cargar páginas adicionales.
- Propietario y administradores pueden actualizar el estado. Pasar a pago confirmado, preparación, envío o entrega marca el pago como aprobado; el panel exige confirmación explícita al administrador y el servidor valida el rol y el estado.
- Cada pedido muestra los productos, cantidades, total, contacto, dirección y ubicación si está disponible. El acceso a los datos de compradores está restringido a los roles `owner` y `admin`.
- El inventario muestra alertas de productos agotados, con stock bajo y sin cantidad configurada; desde la alerta se puede abrir directamente la edición del producto.
- Los pedidos se muestran en orden cronológico descendente. No se crean pedidos ficticios para pruebas; si no hay compras reales, el panel muestra un estado vacío.

## Funciones comerciales recientes

- **Envíos e inventario:** el panel de pedidos permite guardar transportadora, número de guía y fecha estimada; puede preparar un mensaje de seguimiento por WhatsApp. Al confirmar pago, el servidor descuenta una sola vez el stock configurado; si se cancela antes del envío, lo repone. El estado Enviado/Entregado guarda su fecha.
- **Cupones:** el panel permite crear, editar, pausar y limitar cupones porcentuales o fijos; el servidor vuelve a comprobar vigencia, monto mínimo y usos al guardar un pedido.
- **Reseñas:** los clientes que tengan una compra marcada como entregada pueden enviar una reseña por producto. Todas comienzan pendientes y el propietario/administrador decide si se publican.
- **Favoritos:** se guardan localmente para visitantes y en Supabase para clientes con sesión. La página favoritos.html muestra la lista guardada.
- **Catálogo:** filtros de precio, solo ofertas, ocultar productos con stock cero y etiquetas de stock cuando existe una cantidad configurada.
- **CRM y métricas:** el panel muestra dirección guardada, conteos de pedidos y gasto confirmado por cliente; incluye ingresos netos, descuentos, cancelaciones, compradores recurrentes, ventas por categoría y filtros por fecha. Los pedidos cargados se pueden exportar a CSV.
- **Perfil y checkout:** perfil y checkout leen la información guardada; el checkout usa metadatos como respaldo para campos de perfil que aún estén vacíos.

## Integración de Bold

- `bold-payments`: prepara el checkout de Bold usando el total registrado en `orders`, genera la firma SHA-256 en el servidor y permite consultar el estado de la transacción.
- `bold-webhook`: valida la cabecera `x-bold-signature` (HMAC-SHA256 sobre el cuerpo codificado en Base64) y comprueba referencia, moneda e importe antes de aplicar el estado recibido.
- `bold-checkout.js` abre la pasarela desde el botón propio de NovaShop; `pago.html` consulta el estado en el servidor y no confía en `bold-tx-status` como prueba de pago.
- Configura como secretos de Edge Functions `BOLD_API_KEY` (llave de identidad del botón de pagos) y `BOLD_SECRET_KEY` (llave secreta de ese mismo ambiente). Opcionalmente define `NOVASHOP_SITE_URL` con la URL pública completa del sitio.
- Para probar el checkout, configura `BOLD_API_KEY` y `BOLD_SECRET_KEY` con la pareja de llaves de prueba y define `BOLD_ENVIRONMENT=test`. La página de retorno consulta la transacción en Bold, pero el resultado de prueba no marca pedidos como pagados ni descuenta inventario. Las notificaciones webhook de sandbox no se envían automáticamente; la función de webhook reconoce el modo de prueba y nunca modifica pedidos en ese ambiente.
- Antes de vender en producción, configura la pareja de llaves de producción, define `BOLD_ENVIRONMENT=live` y registra en el panel de Bold el endpoint `https://fbcffmhcypsprvgdbtas.supabase.co/functions/v1/bold-webhook` como webhook de Botón de pagos. Verifica con una transacción real de bajo importe antes de ofrecerlo a todos los clientes.
- El monto de Bold corresponde al total de productos menos descuentos y el envío es gratis para compras pagadas en línea. Los pedidos contraentrega cotizan el flete por separado; el cliente paga ese flete por anticipado a la transportadora y paga el producto al recibirlo. El panel administrativo debe registrar el valor real del flete y verificar su pago antes de marcar el pedido como enviado.
- No guardes llaves privadas en GitHub ni en archivos públicos del frontend.
