# Checkout de CifraLock con una cuenta Paddle compartida

El backend fija `checkout.url` a `FRONTEND_URL` + `/checkout`. El frontend abre el enlace de esa transacción y carga Paddle.js en la página pública `/checkout`. No depende del Default payment link global para elegir el destino.

Variables del backend en Railway:

```dotenv
FRONTEND_URL=https://TU-DOMINIO-DE-CIFRALOCK
PADDLE_SANDBOX=true
PADDLE_CLIENT_TOKEN=test_TOKEN_PUBLICO_DE_PADDLE
PADDLE_API_KEY=CLAVE_PRIVADA
PADDLE_PRICE_ID=pri_PRECIO_DE_CIFRALOCK
PADDLE_WEBHOOK_SECRET=SECRETO_DEL_WEBHOOK_DE_CIFRALOCK
```

Reemplaza los ejemplos con valores del mismo entorno. Crea el client-side token en Paddle → My account → Settings → Authentication. En live usa `PADDLE_SANDBOX=false` y token `live_...`. Si existe `PADDLE_API_URL`, debe apuntar al mismo entorno.

En el frontend conserva `NEXT_PUBLIC_API_URL` apuntando al backend de CifraLock. El token público se obtiene de `/api/billing/config`; no se expone la API key. El frontend vuelve a `/plan?checkout=success` tras el pago; el plan sigue dependiendo de la confirmación del backend por webhook.

Despliega ambos repositorios. Mantén un Default payment link válido en Paddle y registra el dominio de CifraLock en Website approval (aprobación requerida en live). No reemplaces la URL global cada vez que uses otra aplicación. Los enlaces antiguos no se reescriben con este cambio; prueba iniciando un checkout nuevo desde CifraLock.

La URL del webhook de CifraLock sigue siendo `https://TU-BACKEND/api/billing/webhook`. Los enlaces automáticos de actualización de tarjeta pueden seguir usando el default global: este cambio corrige los pagos iniciados desde CifraLock.

Validación: `node --import tsx --test test/checkout.test.ts` en backend; `npm run build` en frontend. Las pruebas del backend simulan Paddle y no realizan cobros.