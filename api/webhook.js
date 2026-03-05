// ============================================================
//  Elementor Pro → Monday.com Webhook Bridge
//  Endpoint: POST /api/webhook
// ============================================================

// Desactivar el body parser de Vercel para manejarlo manualmente
export const config = {
  api: { bodyParser: false },
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
const ALLOWED_VALUES = {
  "Idioma de Contacto":   ["Castellano", "Alemán", "Catalán", "Croata", "Francés", "Inglés", "Otros", "Polaco", "Ruso", "Sueco", "Ucraniano"],
  "Destino de Vivienda":  ["Primera vivienda", "Segunda vivienda", "Inversión", "Reposición"],
  "Nº de Dormitorios":    ["2 Dormitorios", "3 Dormitorios", "4 Dormitorios", "Local Comercial", "Garaje", "Trastero"],
  "Presupuesto estimado": ["- 100K", "100K - 150K", "150K - 200K", "200K - 250K", "250K - 300K", "300K - 350K", "350K - 400K", "400K - 450K", "450K - 500K", "500K - 550K", "550K - 600K", "600K - 650K", "650K - 700K", "700K - 750K", "750K - 800K", "800K - 850K", "850K - 900K", "900K - 950K", "950K - 1M", "+ 1M"],
  "Edad":                 ["> 30", "31 - 45", "46 - 55", "56 - 65", "< 65"],
};

// ── Mapeo campos Elementor → columnas Monday ──────────────────
// Las claves son los nombres EXACTOS que envía Elementor Pro
const FIELD_MAP = {
  "Nombre y Apellidos":   { id: "name",             type: "name"     },
  "Correo electrónico":   { id: "lead_email",        type: "email"    },
  "Teléfono":             { id: "lead_phone",         type: "phone"    },
  "Código Postal":        { id: "text_mm12yqx0",     type: "text"     },
  "Destino de Vivienda":  { id: "color_mm0ee37e",    type: "status"   },
  "Edad":                 { id: "color_mksg46wh",    type: "status"   },
  "Presupuesto estimado": { id: "color_mm1274dx",    type: "status"   },
  "Nº de Dormitorios":    { id: "dropdown_mksd92xa", type: "dropdown" },
  "Idioma de Contacto":   { id: "dropdown_mm131mxd", type: "dropdown" },
};

// ── Formateadores por tipo ────────────────────────────────────
function formatColumnValue(type, value) {
  if (!value) return null;
  switch (type) {
    case "name":     return value;
    case "email":    return { email: value, text: value };
    case "phone":    return { phone: value.replace(/\s/g, ""), countryShortName: "ES" };
    case "text":     return value;
    case "status":   return { label: value };
    case "dropdown": {
      // Acepta valor único o múltiples separados por coma
      const labels = Array.isArray(value)
        ? value
        : value.split(",").map(v => v.trim()).filter(Boolean);
      return { labels };
    }
    case "date":     return { date: new Date(value).toISOString().split("T")[0] };
    case "numbers":  return parseFloat(value) || 0;
    default:         return value;
  }
}

// ── Construye column_values ───────────────────────────────────
function buildColumnValues(formData) {
  const columns = {};

  for (const [formField, config] of Object.entries(FIELD_MAP)) {
    if (config.type === "name") continue;
    const rawValue = formData[formField];
    if (!rawValue) continue;
    const formatted = formatColumnValue(config.type, rawValue);
    if (formatted !== null) columns[config.id] = formatted;
  }

  // Valores fijos automáticos
  columns["boolean_mkvw55qp"] = { checked: "true" };          // Política de Privacidad
  columns["lead_status"]       = { label: "Lead nuevo" };      // Estado Lead
  columns["color_mks9ct6h"]    = { label: "Formulario web" };  // Origen del contacto
  columns["color_mks7cm2f"]    = { label: "Mail" };            // Tipo de gestión

  return JSON.stringify(columns);
}

// ── Nombre del item ───────────────────────────────────────────
function getItemName(formData) {
  return (
    formData["Nombre y Apellidos"] ||
    formData["Correo electrónico"] ||
    `Lead ${new Date().toLocaleString("es-ES")}`
  );
}

// ── Mutación Monday.com ───────────────────────────────────────
async function createMondayItem(formData) {
  const mutation = `
    mutation {
      create_item(
        board_id: ${MONDAY_BOARD_ID},
        group_id: "${MONDAY_GROUP_ID}",
        item_name: ${JSON.stringify(getItemName(formData))},
        column_values: ${JSON.stringify(buildColumnValues(formData))}
      ) { id name url }
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
  if (result.errors) throw new Error(`Monday API error: ${JSON.stringify(result.errors)}`);
  return result.data.create_item;
}

// ── Secreto ───────────────────────────────────────────────────
function verifySecret(req) {
  if (!WEBHOOK_SECRET) return true;
  const incoming = req.headers["x-webhook-secret"] || req.headers["authorization"];
  return incoming === WEBHOOK_SECRET || incoming === `Bearer ${WEBHOOK_SECRET}`;
}

// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-webhook-secret");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Usa POST." });
  if (!verifySecret(req))       return res.status(401).json({ error: "No autorizado." });

  if (!MONDAY_API_KEY || !MONDAY_BOARD_ID) {
    return res.status(500).json({ error: "Faltan variables de entorno." });
  }

  try {
    // Parsear body — soporta JSON (Postman) y form-urlencoded (Elementor)
    const rawBody     = await getRawBody(req);
    const contentType = req.headers["content-type"] || "";
    const formData    = contentType.includes("application/json")
      ? JSON.parse(rawBody)
      : Object.fromEntries(new URLSearchParams(rawBody));

    console.log("📨 Datos recibidos:", JSON.stringify(formData, null, 2));

    if (!formData || Object.keys(formData).length === 0) {
      return res.status(400).json({ error: "Body vacío." });
    }

    // Validación de valores permitidos (soporta múltiples separados por coma)
    const errors = [];
    for (const [field, allowed] of Object.entries(ALLOWED_VALUES)) {
      const raw = formData[field];
      if (!raw) continue;
      const values = Array.isArray(raw) ? raw : raw.split(",").map(v => v.trim()).filter(Boolean);
      for (const v of values) {
        if (!allowed.includes(v)) {
          errors.push(`"${field}": "${v}" no válido. Opciones: ${allowed.join(", ")}`);
        }
      }
    }
    if (errors.length > 0) return res.status(400).json({ error: "Valores no válidos", details: errors });

    const item = await createMondayItem(formData);
    console.log(`✅ Item creado: ${item.id} — "${item.name}"`);

    return res.status(200).json({
      success: true,
      message: "Item creado en Monday.com correctamente.",
      item: { id: item.id, name: item.name, url: item.url },
    });

  } catch (error) {
    console.error("❌ Error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}
