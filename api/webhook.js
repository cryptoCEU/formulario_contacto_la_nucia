// ============================================================
//  Elementor Pro → Monday.com Webhook Bridge
//  Endpoint: POST /api/webhook
// ============================================================

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_KEY  = process.env.MONDAY_API_KEY;
const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID;
const MONDAY_GROUP_ID = process.env.MONDAY_GROUP_ID || "topics";
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET;   // opcional pero recomendado

// ── Mapeo de campos de Elementor → columnas de Monday ────────
// Las claves izquierdas deben coincidir con los nombres de campo en tu formulario Elementor
const FIELD_MAP = {
  nombre:             { id: "name",             type: "name"   },  // título del item, obligatorio
  email:              { id: "lead_email",        type: "email"  },
  codigo_postal:      { id: "text_mm12yqx0",    type: "text"   },
  provincia:          { id: "text_mkwhbx60",    type: "text"   },
  delegacion:         { id: "text_mkwhpd6x",    type: "text"   },
  tipo_gestion:       { id: "color_mks7cm2f",   type: "status" },
  origen_contacto:    { id: "color_mks9ct6h",   type: "status" },
  intento_contacto:   { id: "color_mks9aktw",   type: "status" },
  estado_lead:        { id: "lead_status",       type: "status" },
  rango_edad:         { id: "color_mksg46wh",   type: "status" },
  visita_realizada:   { id: "color_mm0et2vw",   type: "status" },
  presupuesto:        { id: "color_mm1274dx",   type: "status" },
  destino_vivienda:   { id: "color_mm0ee37e",   type: "status" },
  unidad_familiar:    { id: "color_mm0ew60h",   type: "status" },
  estado_civil:       { id: "color_mm0ew45j",   type: "status" },
  num_hijos:          { id: "color_mm0e3c9q",   type: "status" },
  ingresos_mensuales: { id: "color_mm0eg8bk",   type: "status" },
  urgencia_compra:    { id: "color_mm0ejxxb",   type: "status" },
};

// ── Formateadores por tipo de columna de Monday ──────────────
function formatColumnValue(type, value) {
  if (!value) return null;

  switch (type) {
    case "name":
      return value; // se usa como item_name, no en column_values

    case "email":
      return JSON.stringify({ email: value, text: value });

    case "phone":
      return JSON.stringify({ phone: value, countryShortName: "ES" });

    case "text":
    case "long_text":
      return JSON.stringify({ text: value });

    case "date": {
      const d = new Date(value);
      const dateStr = d.toISOString().split("T")[0];
      return JSON.stringify({ date: dateStr });
    }

    case "status":
      return JSON.stringify({ label: value });

    case "numbers":
      return String(parseFloat(value) || 0);

    default:
      return JSON.stringify(value);
  }
}

// ── Construye column_values para la mutación GraphQL ─────────
function buildColumnValues(formData) {
  const columns = {};

  for (const [formField, config] of Object.entries(FIELD_MAP)) {
    if (config.type === "name") continue; // se pasa como item_name
    const rawValue = formData[formField];
    if (!rawValue) continue;

    const formatted = formatColumnValue(config.type, rawValue);
    if (formatted !== null) {
      columns[config.id] = formatted;
    }
  }

  return JSON.stringify(columns);
}

// ── Extrae el nombre del item (título de la fila en Monday) ──
function getItemName(formData) {
  return (
    formData["nombre"] ||
    formData["name"]   ||
    formData["email"]  ||
    `Lead ${new Date().toLocaleString("es-ES")}`
  );
}

// ── Envía la mutación a Monday.com ───────────────────────────
async function createMondayItem(formData) {
  const itemName     = getItemName(formData);
  const columnValues = buildColumnValues(formData);

  const mutation = `
    mutation {
      create_item(
        board_id: ${MONDAY_BOARD_ID},
        group_id: "${MONDAY_GROUP_ID}",
        item_name: ${JSON.stringify(itemName)},
        column_values: ${JSON.stringify(columnValues)}
      ) {
        id
        name
        url
      }
    }
  `;

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": MONDAY_API_KEY,
      "API-Version":   "2024-01",
    },
    body: JSON.stringify({ query: mutation }),
  });

  const result = await response.json();

  if (result.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(result.errors)}`);
  }

  return result.data.create_item;
}

// ── Verifica el secreto del webhook (seguridad opcional) ─────
function verifySecret(req) {
  if (!WEBHOOK_SECRET) return true;
  const incoming = req.headers["x-webhook-secret"] || req.headers["authorization"];
  return incoming === WEBHOOK_SECRET || incoming === `Bearer ${WEBHOOK_SECRET}`;
}

// ── Handler principal de Vercel ──────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-webhook-secret");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido. Usa POST." });
  }

  if (!verifySecret(req)) {
    return res.status(401).json({ error: "No autorizado. Secreto incorrecto." });
  }

  if (!MONDAY_API_KEY || !MONDAY_BOARD_ID) {
    return res.status(500).json({
      error: "Configuración incompleta. Revisa MONDAY_API_KEY y MONDAY_BOARD_ID en las variables de entorno.",
    });
  }

  try {
    const formData = req.body;

    if (process.env.NODE_ENV !== "production") {
      console.log("📨 Datos recibidos de Elementor:", JSON.stringify(formData, null, 2));
    }

    if (!formData || Object.keys(formData).length === 0) {
      return res.status(400).json({ error: "Cuerpo de la petición vacío." });
    }

    const item = await createMondayItem(formData);

    console.log(`✅ Item creado en Monday: ID ${item.id} — "${item.name}"`);

    return res.status(200).json({
      success: true,
      message: "Item creado en Monday.com correctamente.",
      item: {
        id:   item.id,
        name: item.name,
        url:  item.url,
      },
    });

  } catch (error) {
    console.error("❌ Error al crear item en Monday:", error.message);

    return res.status(500).json({
      success: false,
      error:   error.message,
    });
  }
}
