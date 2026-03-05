// ============================================================
//  Elementor Pro → Monday.com Webhook Bridge
//  Endpoint: POST /api/webhook
// ============================================================

// Desactivar el body parser de Vercel para manejarlo manualmente
export const config = {
  api: {
    bodyParser: false,
  },
};

// Lee el body crudo de la petición
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end",  () => resolve(data));
    req.on("error", reject);
  });
}

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_KEY  = process.env.MONDAY_API_KEY;
const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID;
const MONDAY_GROUP_ID = process.env.MONDAY_GROUP_ID || "topics";
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET;

// ── Valores permitidos por campo ─────────────────────────────
// Estos valores deben coincidir EXACTAMENTE con las opciones en Monday
const ALLOWED_VALUES = {
  "Idioma de Contacto":   ["Castellano", "Alemán", "Catalán", "Croata", "Francés", "Inglés", "Otros", "Polaco", "Ruso", "Sueco", "Ucraniano"],
  "Destino de Vivienda":  ["Primera vivienda", "Segunda vivienda", "Inversión", "Reposición"],
  "Nº de Dormitorios":    ["2 Dormitorios", "3 Dormitorios", "4 Dormitorios", "Local Comercial", "Garaje", "Trastero"],
  "Presupuesto estimado": ["- 100K", "100K - 150K", "150K - 200K", "200K - 250K", "250K - 300K", "300K - 350K", "350K - 400K", "400K - 450K", "450K - 500K", "500K - 550K", "550K - 600K", "600K - 650K", "650K - 700K", "700K - 750K", "750K - 800K", "800K - 850K", "850K - 900K", "900K - 950K", "950K - 1M", "+ 1M"],
  "Edad":                 ["< 30", "31 - 45", "46 - 55", "56 - 65", "> 65"],
};

// ── Mapeo de campos de Elementor → columnas de Monday ────────
// Clave izquierda = ID del campo en tu formulario de Elementor
const FIELD_MAP = {
  nombre_y_apellidos:   { id: "name",              type: "name"     },  // Nombre
  correo_electronico:   { id: "lead_email",         type: "email"    },  // E-mail
  telefono:             { id: "lead_phone",          type: "phone"    },  // Teléfono
  codigo_postal:        { id: "text_mm12yqx0",      type: "text"     },  // Código Postal
  destino_de_vivienda:  { id: "color_mm0ee37e",     type: "status"   },  // Destino vivienda
  edad:                 { id: "color_mksg46wh",     type: "status"   },  // Rango Edad
  num_dormitorios:      ["2 Dormitorios", "3 Dormitorios", "4 Dormitorios", "Local Comercial", "Garaje", "Trastero"],
  presupuesto_estimado: { id: "color_mm1274dx",     type: "status"   },  // Presupuesto
  num_dormitorios:      { id: "dropdown_mksd92xa",  type: "dropdown" },  // Tipología interés
  idioma_de_contacto:   { id: "dropdown_mm131mxd",  type: "dropdown" },  // Idioma preferido
};

// ── Formateadores por tipo de columna de Monday ──────────────
// Devuelven objetos planos (NO strings) — la serialización final
// se hace una sola vez en buildColumnValues con JSON.stringify
function formatColumnValue(type, value) {
  if (!value) return null;

  switch (type) {
    case "name":
      return value;

    case "email":
      return { email: value, text: value };

    case "phone": {
      const clean = value.replace(/\s/g, "");
      return { phone: clean, countryShortName: "ES" };
    }

    case "text":
    case "long_text":
      return value;

    case "date": {
      const d = new Date(value);
      const dateStr = d.toISOString().split("T")[0];
      return { date: dateStr };
    }

    case "status":
      return { label: value };

    case "dropdown":
      return { labels: [value] };

    case "numbers":
      return parseFloat(value) || 0;

    default:
      return value;
  }
}

// ── Construye column_values para la mutación GraphQL ─────────
function buildColumnValues(formData) {
  const columns = {};

  for (const [formField, config] of Object.entries(FIELD_MAP)) {
    if (config.type === "name") continue;
    const rawValue = formData[formField];
    if (!rawValue) continue;

    const formatted = formatColumnValue(config.type, rawValue);
    if (formatted !== null) {
      columns[config.id] = formatted;
    }
  }

  // Política de Privacidad siempre marcada como aceptada
  columns["boolean_mkvw55qp"] = { checked: "true" };

  // Estado Lead siempre fijo como "Lead nuevo"
  columns["lead_status"] = { label: "Lead nuevo" };

  // Origen del contacto siempre fijo como "Formulario web"
  columns["color_mks9ct6h"] = { label: "Formulario web" };

  // Tipo de gestión siempre fijo como "Mail"
  columns["color_mks7cm2f"] = { label: "Mail" };

  return JSON.stringify(columns);
}

// ── Extrae el nombre del item ─────────────────────────────────
function getItemName(formData) {
  return (
    formData["Nombre y Apellidos"] ||
    formData["Correo electrónico"] ||
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

// ── Verifica el secreto del webhook ──────────────────────────
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

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido. Usa POST." });
  }

  if (!verifySecret(req)) {
    return res.status(401).json({ error: "No autorizado. Secreto incorrecto." });
  }

  if (!MONDAY_API_KEY || !MONDAY_BOARD_ID) {
    return res.status(500).json({
      error: "Configuración incompleta. Revisa MONDAY_API_KEY y MONDAY_BOARD_ID.",
    });
  }

  try {
    // Leer y parsear el body manualmente
    const rawBody = await getRawBody(req);
    const contentType = req.headers["content-type"] || "";
    let formData;

    if (contentType.includes("application/json")) {
      formData = JSON.parse(rawBody);
    } else {
      // form-urlencoded (lo que envía Elementor Pro)
      formData = Object.fromEntries(new URLSearchParams(rawBody));
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("📨 Datos recibidos de Elementor:", JSON.stringify(formData, null, 2));
    }

    if (!formData || Object.keys(formData).length === 0) {
      return res.status(400).json({ error: "Cuerpo de la petición vacío." });
    }

    // Validar que los valores estén dentro de los permitidos
    const validationErrors = [];
    for (const [field, allowed] of Object.entries(ALLOWED_VALUES)) {
      const value = formData[field];
      if (value && !allowed.includes(value)) {
        validationErrors.push(`Campo "${field}": valor "${value}" no permitido. Valores válidos: ${allowed.join(", ")}`);
      }
    }
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: "Valores no válidos", details: validationErrors });
    }

    const item = await createMondayItem(formData);

    console.log(`✅ Item creado en Monday: ID ${item.id} — "${item.name}"`);

    return res.status(200).json({
      success: true,
      message: "Item creado en Monday.com correctamente.",
      item: { id: item.id, name: item.name, url: item.url },
    });

  } catch (error) {
    console.error("❌ Error al crear item en Monday:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}
