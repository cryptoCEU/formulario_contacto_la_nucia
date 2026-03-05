// ============================================================
//  Utilidad: Ver columnas de tu tablero en Monday.com
//  Endpoint: GET /api/columns
//  Úsalo UNA SOLA VEZ para obtener los IDs de tus columnas
//  y mapearlos en api/webhook.js → FIELD_MAP
// ============================================================

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_KEY  = process.env.MONDAY_API_KEY;
const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID;

export default async function handler(req, res) {
  if (!MONDAY_API_KEY || !MONDAY_BOARD_ID) {
    return res.status(500).json({ error: "Faltan variables de entorno." });
  }

  const query = `
    query {
      boards(ids: [${MONDAY_BOARD_ID}]) {
        name
        groups { id title }
        columns {
          id
          title
          type
          description
        }
      }
    }
  `;

  try {
    const response = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": MONDAY_API_KEY,
        "API-Version":   "2024-01",
      },
      body: JSON.stringify({ query }),
    });

    const result = await response.json();

    if (result.errors) {
      return res.status(400).json({ errors: result.errors });
    }

    const board = result.data.boards[0];

    return res.status(200).json({
      board_name: board.name,
      board_id:   MONDAY_BOARD_ID,
      groups:     board.groups,
      columns:    board.columns.map(c => ({
        id:          c.id,
        title:       c.title,
        type:        c.type,
        description: c.description,
      })),
      tip: "Copia los 'id' de las columnas que necesites y pégalos en FIELD_MAP dentro de api/webhook.js",
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
