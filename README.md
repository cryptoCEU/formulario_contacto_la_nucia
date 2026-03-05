# Elementor Pro → Monday.com Webhook Bridge

Serverless function que recibe los datos de un formulario de **Elementor Pro** y crea automáticamente un item en tu tablero de **Monday.com** usando su API GraphQL.

---

## Arquitectura

```
WordPress / Elementor Pro
        │
        │  POST (JSON)
        ▼
  Vercel Serverless
   /api/webhook.js
        │
        │  GraphQL mutation
        ▼
   Monday.com API
   (crea item en tu tablero)
```

---

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/webhook` | Recibe datos de Elementor y crea item en Monday |
| `GET`  | `/api/health`  | Verifica que el servicio y variables estén OK |
| `GET`  | `/api/columns` | Lista columnas de tu tablero (para configurar el mapeo) |

---

## Configuración paso a paso

### 1. Clonar y preparar

```bash
git clone https://github.com/tu-usuario/elementor-monday-webhook.git
cd elementor-monday-webhook
npm install
```

### 2. Obtener API Key de Monday.com

1. Entra a **monday.com**
2. Haz clic en tu **avatar** (esquina inferior izquierda)
3. Ve a **Administration → API**
4. Copia tu **API v2 Token**

### 3. Obtener Board ID de Monday.com

Abre tu tablero. La URL tiene este formato:
```
https://tu-empresa.monday.com/boards/1234567890
                                            ↑
                                       Este es tu BOARD_ID
```

### 4. Configurar variables de entorno

```bash
cp .env.example .env.local
```

Edita `.env.local` con tus valores reales:
```env
MONDAY_API_KEY=eyJhb...tu_token
MONDAY_BOARD_ID=1234567890
MONDAY_GROUP_ID=topics
WEBHOOK_SECRET=mi_secreto_super_seguro
```

### 5. Ver columnas de tu tablero

Despliega primero y llama a:
```
GET https://tu-proyecto.vercel.app/api/columns
```

Esto te devuelve los IDs de tus columnas. Cópialos en `FIELD_MAP` dentro de `api/webhook.js`:

```javascript
const FIELD_MAP = {
  nombre:   { id: "name",         type: "name"  },
  email:    { id: "email",        type: "email" },
  telefono: { id: "phone__1",     type: "phone" },
  mensaje:  { id: "long_text__1", type: "text"  },
  // Agrega tus columnas aquí según los IDs devueltos por /api/columns
};
```

---

## Despliegue en Vercel

### Opción A: Con CLI de Vercel

```bash
# Instalar CLI si no la tienes
npm i -g vercel

# Login
vercel login

# Desplegar con variables de entorno
vercel --prod \
  -e MONDAY_API_KEY=tu_key \
  -e MONDAY_BOARD_ID=tu_board_id \
  -e MONDAY_GROUP_ID=topics \
  -e WEBHOOK_SECRET=tu_secreto
```

### Opción B: Desde GitHub (recomendado)

1. Sube el proyecto a GitHub
2. Entra a [vercel.com](https://vercel.com) → **New Project**
3. Importa tu repositorio
4. En **Environment Variables**, agrega:
   - `MONDAY_API_KEY`
   - `MONDAY_BOARD_ID`
   - `MONDAY_GROUP_ID`
   - `WEBHOOK_SECRET` (opcional)
5. Haz clic en **Deploy**

Tu webhook quedará en:
```
https://tu-proyecto.vercel.app/api/webhook
```

---

## Pruebas con Postman

### 1. Health check
```
GET https://tu-proyecto.vercel.app/api/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "config": {
    "MONDAY_API_KEY": "✅ configurada",
    "MONDAY_BOARD_ID": "✅ configurada"
  }
}
```

### 2. Simular formulario de Elementor

```
POST https://tu-proyecto.vercel.app/api/webhook
Content-Type: application/json
x-webhook-secret: tu_secreto   ← si configuraste WEBHOOK_SECRET

Body (raw JSON):
{
  "nombre":   "Juan García",
  "email":    "juan@ejemplo.com",
  "telefono": "+34 600 000 000",
  "empresa":  "Mi Empresa SL",
  "mensaje":  "Me interesa su servicio de consultoría.",
  "fecha":    "2024-03-15"
}
```

Respuesta esperada:
```json
{
  "success": true,
  "message": "Item creado en Monday.com correctamente.",
  "item": {
    "id": "1234567890",
    "name": "Juan García",
    "url": "https://tu-empresa.monday.com/boards/.../items/..."
  }
}
```

---

## Configuración en Elementor Pro

1. Abre tu formulario en el editor de **Elementor**
2. Ve a la pestaña **"Acciones después del envío"**
3. Haz clic en **"+ Agregar acción"** → **"Webhook"**
4. Pega tu URL:
   ```
   https://tu-proyecto.vercel.app/api/webhook
   ```
5. (Opcional) Si usas `WEBHOOK_SECRET`, agrega el header:
   - Header: `x-webhook-secret`
   - Valor: `tu_secreto`
6. **Guarda** y publica la página

> ⚠️ **Importante:** Los nombres de los campos del formulario en Elementor deben coincidir con las claves del `FIELD_MAP` en `api/webhook.js` (nombre, email, telefono, etc.)

---

## Tipos de columnas soportados

| Tipo Monday | `type` en FIELD_MAP |
|-------------|---------------------|
| Texto corto | `"text"` |
| Texto largo | `"text"` |
| Email | `"email"` |
| Teléfono | `"phone"` |
| Fecha | `"date"` |
| Estado | `"status"` |
| Números | `"numbers"` |

---

## Solución de problemas

**El item se crea pero los campos están vacíos**
→ Verifica que los `id` de columna en `FIELD_MAP` coincidan exactamente con los que devuelve `/api/columns`

**Error 401**
→ El `WEBHOOK_SECRET` no coincide o está mal configurado en Elementor

**Error de Monday API**
→ Verifica que el `MONDAY_API_KEY` sea correcto y tenga permisos de escritura en el tablero

**Los campos de Elementor no llegan**
→ Asegúrate de que los **nombres** de los campos en Elementor Pro coincidan con las claves del `FIELD_MAP`

---

## Licencia

MIT
