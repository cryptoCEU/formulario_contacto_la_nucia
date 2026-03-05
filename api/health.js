// ============================================================
//  Health Check
//  Endpoint: GET /api/health
// ============================================================

export default function handler(req, res) {
  const config = {
    MONDAY_API_KEY:  !!process.env.MONDAY_API_KEY  ? "✅ configurada" : "❌ FALTA",
    MONDAY_BOARD_ID: !!process.env.MONDAY_BOARD_ID ? "✅ configurada" : "❌ FALTA",
    MONDAY_GROUP_ID: process.env.MONDAY_GROUP_ID   || "topics (default)",
    WEBHOOK_SECRET:  !!process.env.WEBHOOK_SECRET  ? "✅ configurada" : "⚠️  no configurada (opcional)",
  };

  const allGood = !!process.env.MONDAY_API_KEY && !!process.env.MONDAY_BOARD_ID;

  return res.status(allGood ? 200 : 503).json({
    status:    allGood ? "ok" : "misconfigured",
    timestamp: new Date().toISOString(),
    service:   "elementor-monday-webhook",
    version:   "1.0.0",
    config,
  });
}
