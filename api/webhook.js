"use client";
import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Download, RefreshCw, Bot, XCircle, MessageSquare,
  FileSpreadsheet, Loader2, ExternalLink, Calendar,
  ChevronDown, Search, BarChart2, TableProperties,
  Layers, Plus, Trash2, Check, X, Pencil, AlertCircle, Hash,
  ChevronRight, FileJson, FileText, FlaskConical, Info, LogOut,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import type { Queue } from "@/lib/queues";
import { getQueueForAgent } from "@/lib/queues";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Agent { agent_id: string; name: string; }
interface ConversationSummary {
  conversation_id: string; agent_id: string; status: string;
  start_time_unix_secs: number; call_duration_secs: number; message_count: number;
  caller_phone: string;
  called_phone: string;
  ring_secs: number;
  ended_by: string;
}
type Grouping = "dia" | "semana" | "mes" | "hora";
type RangePreset = "7d" | "30d" | "90d" | "custom";
type MainTab = "datos" | "colas";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(secs: number) {
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function presetDates(p: RangePreset) {
  const to = new Date(), from = new Date();
  if (p === "7d") from.setDate(from.getDate() - 6);
  else if (p === "30d") from.setDate(from.getDate() - 29);
  else if (p === "90d") from.setDate(from.getDate() - 89);
  return { from: toISO(from), to: toISO(to) };
}
function groupKey(unix: number, g: Grouping) {
  const d = new Date(unix * 1000);
  if (g === "hora") return `${String(d.getHours()).padStart(2, "0")}h`;
  if (g === "dia") return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
  if (g === "semana") {
    const t = new Date(d); t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    return `Sem ${t.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })}`;
  }
  return d.toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
}
function sortKey(unix: number, g: Grouping) {
  const d = new Date(unix * 1000);
  if (g === "hora") return String(d.getHours()).padStart(2, "0");
  if (g === "dia") return toISO(d);
  if (g === "semana") { const t = new Date(d); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return toISO(t); }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Queue API helpers (client-side) ───────────────────────────────────────────
async function apiGetQueues(): Promise<Queue[]> {
  const r = await fetch("/api/queues"); const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d.queues;
}
async function apiCreateQueue(name: string): Promise<Queue> {
  const r = await fetch("/api/queues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error);
  return d.queue;
}
async function apiUpdateQueue(id: string, updates: Partial<Queue>): Promise<Queue> {
  const r = await fetch(`/api/queues/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error);
  return d.queue;
}
async function apiDeleteQueue(id: string): Promise<void> {
  const r = await fetch(`/api/queues/${id}`, { method: "DELETE" });
  if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
}
async function apiGetAgentCodes(): Promise<Record<string, string>> {
  const r = await fetch("/api/agent-codes"); const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
async function apiSetAgentCode(agent_id: string, code: string): Promise<void> {
  const r = await fetch("/api/agent-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id, code }) });
  if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, unit = "" }: {
  active?: boolean; payload?: { value: number; color: string }[]; label?: string; unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #2a2a3e", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <div style={{ color: "var(--muted)", marginBottom: 6, fontFamily: "monospace" }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block" }} />
          {p.value}{unit}
        </div>
      ))}
    </div>
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function useStats(conversations: ConversationSummary[], grouping: Grouping) {
  return useMemo(() => {
    if (!conversations.length) return null;
    const grouped: Record<string, { label: string; sk: string; total: number; durSum: number }> = {};
    const byHour: Record<number, number> = {};
    const byStatus: Record<string, number> = {};
    const durBuckets: Record<string, number> = { "<1m": 0, "1-2m": 0, "2-5m": 0, "5-10m": 0, ">10m": 0 };
    for (const c of conversations) {
      const t = c.start_time_unix_secs, dur = c.call_duration_secs ?? 0;
      const label = groupKey(t, grouping), sk = sortKey(t, grouping), dt = new Date(t * 1000);
      if (!grouped[sk]) grouped[sk] = { label, sk, total: 0, durSum: 0 };
      grouped[sk].total++; grouped[sk].durSum += dur;
      byHour[dt.getHours()] = (byHour[dt.getHours()] ?? 0) + 1;
      const st = c.status?.toLowerCase() ?? "unknown";
      byStatus[st] = (byStatus[st] ?? 0) + 1;
      if (dur < 60) durBuckets["<1m"]++;
      else if (dur < 120) durBuckets["1-2m"]++;
      else if (dur < 300) durBuckets["2-5m"]++;
      else if (dur < 600) durBuckets["5-10m"]++;
      else durBuckets[">10m"]++;
    }
    const groupedData = Object.values(grouped).sort((a, b) => a.sk.localeCompare(b.sk))
      .map(v => ({ date: v.label, llamadas: v.total, durMedia: Math.round(v.durSum / v.total / 60 * 10) / 10 }));
    const hourData = Array.from({ length: 24 }, (_, h) => ({ hora: `${String(h).padStart(2, "0")}h`, llamadas: byHour[h] ?? 0 }));
    const statusData = Object.entries(byStatus).map(([name, value]) => ({ name, value }));
    const durData = Object.entries(durBuckets).map(([name, value]) => ({ name, value }));
    const totalDur = conversations.reduce((a, c) => a + (c.call_duration_secs ?? 0), 0);
    const avgDur = Math.round(totalDur / conversations.length);
    const maxDur = Math.max(...conversations.map(c => c.call_duration_secs ?? 0));
    const completed = conversations.filter(c => ["done", "completed"].includes(c.status?.toLowerCase())).length;
    const totalMessages = conversations.reduce((a, c) => a + (c.message_count ?? 0), 0);
    const avgMessages = Math.round(totalMessages / conversations.length);
    const msgBuckets: Record<string, number> = { "0": 0, "1-5": 0, "6-10": 0, "11-20": 0, "21-50": 0, ">50": 0 };
    for (const c of conversations) {
      const m = c.message_count ?? 0;
      if (m === 0) msgBuckets["0"]++;
      else if (m <= 5) msgBuckets["1-5"]++;
      else if (m <= 10) msgBuckets["6-10"]++;
      else if (m <= 20) msgBuckets["11-20"]++;
      else if (m <= 50) msgBuckets["21-50"]++;
      else msgBuckets[">50"]++;
    }
    const msgData = Object.entries(msgBuckets).map(([name, value]) => ({ name, value }));
    return { groupedData, hourData, statusData, durData, avgDur, maxDur, completed, totalMessages, avgMessages, msgData };
  }, [conversations, grouping]);
}

const COLORS = ["#8C1736", "var(--muted)", "#4A7A3A", "#A0681A", "#1E1D16"];
const STATUS_COLORS: Record<string, string> = { done: "#4A7A3A", completed: "#4A7A3A", processing: "#A0681A", failed: "#8C1736", error: "#8C1736" };

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: "5px 14px", borderRadius: 20, border: "1px solid", borderColor: active ? "var(--accent)" : "var(--border)", background: active ? "rgba(140,23,54,0.18)" : "transparent", color: active ? "var(--accent)" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Mono', monospace", transition: "all 0.15s", whiteSpace: "nowrap" }}>{label}</button>
  );
}

// ── Agent Dropdown ────────────────────────────────────────────────────────────
function AgentDropdown({ agents, value, onChange }: { agents: Agent[]; value: Agent | null; onChange: (a: Agent | null) => void; }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const rect = btnRef.current?.getBoundingClientRect();

  return (
    <div style={{ position: "relative" }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)} style={{ width: "100%", background: "var(--bg)", border: `1px solid ${open ? "var(--accent)" : "var(--border)"}`, borderRadius: 2, color: value ? "var(--text)" : "var(--muted)", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value ? value.name : "Seleccionar agente..."}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, marginLeft: 8, color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>
      {open && mounted && rect && typeof document !== "undefined" && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div style={{ position: "fixed", top: rect.bottom + 4, left: rect.left, width: rect.width, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 2, zIndex: 9999, boxShadow: "0 8px 32px rgba(30,29,22,0.15)" }}>
            {agents.map(a => (
              <button key={a.agent_id} onClick={() => { onChange(a); setOpen(false); }} style={{ width: "100%", padding: "10px 14px", textAlign: "left", background: value?.agent_id === a.agent_id ? "rgba(140,23,54,0.08)" : "transparent", color: value?.agent_id === a.agent_id ? "var(--accent)" : "var(--text)", border: "none", borderBottom: "1px solid rgba(200,180,154,0.25)", cursor: "pointer", fontSize: 13, fontFamily: "'Jost', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
                <Bot size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />{a.name}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}


// ── Conversation Detail Panel ─────────────────────────────────────────────────
type DetailTab = "transcript" | "analysis" | "metadata" | "raw";

interface ConvDetail {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
  loading: boolean;
  error: string;
}

function fmtSecs(secs: number) {
  if (!secs || secs <= 0) return "0m 00s";
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function ConversationPanel({ convId, agentName, onClose }: {
  convId: string; agentName: string; onClose: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("transcript");
  const [detail, setDetail] = useState<ConvDetail>({ raw: null, loading: true, error: "" });

  useEffect(() => {
    if (!convId) return;
    setDetail({ raw: null, loading: true, error: "" });
    fetch(`/api/conversation-detail/${convId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setDetail({ raw: null, loading: false, error: d.error });
        else setDetail({ raw: d, loading: false, error: "" });
      })
      .catch(e => setDetail({ raw: null, loading: false, error: e.message }));
  }, [convId]);

  const raw = detail.raw;

  const tabs: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
    { id: "transcript", label: "Transcripción", icon: <FileText size={13} /> },
    { id: "analysis",   label: "Análisis",      icon: <FlaskConical size={13} /> },
    { id: "metadata",   label: "Metadatos",     icon: <Info size={13} /> },
    { id: "raw",        label: "JSON Raw",       icon: <FileJson size={13} /> },
  ];

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,29,22,0.4)", zIndex: 200, backdropFilter: "blur(2px)" }} />
      {/* Panel */}
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(680px, 95vw)", background: "var(--surface)", borderLeft: "1px solid var(--border)", zIndex: 201, boxShadow: "-8px 0 32px rgba(30,29,22,0.08)", display: "flex", flexDirection: "column", animation: "slideIn 0.2s ease" }}>
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button onClick={onClose} style={{ background: "rgba(30,29,22,0.06)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", cursor: "pointer", display: "flex", color: "var(--muted)" }}>
            <ChevronRight size={14} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{agentName}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{convId}</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "10px 4px", background: "transparent", border: "none",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === t.id ? "var(--accent)" : "var(--muted)",
              cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "color 0.15s",
            }}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {detail.loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, gap: 10, color: "var(--muted)" }}>
              <Loader2 size={20} className="spinner" /> Cargando...
            </div>
          )}
          {detail.error && (
            <div style={{ padding: 16, background: "rgba(140,23,54,0.06)", border: "1px solid rgba(255,101,132,0.2)", borderRadius: 8, color: "var(--error)", fontSize: 13 }}>
              {detail.error}
            </div>
          )}

          {raw && tab === "transcript" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(raw.transcript ?? []).filter((m: {role:string;message:string|null}) => m.message).map((m: {role:string;message:string;time_in_call_secs:number}, i: number) => (
                <div key={i} style={{
                  display: "flex", flexDirection: "column", gap: 3,
                  alignItems: m.role === "agent" ? "flex-start" : "flex-end",
                }}>
                  <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace", paddingInline: 2 }}>
                    {m.role === "agent" ? "🤖 Agente" : "👤 Usuario"} · {fmtSecs(m.time_in_call_secs)}
                  </div>
                  <div style={{
                    maxWidth: "82%", padding: "9px 13px", borderRadius: m.role === "agent" ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
                    background: m.role === "agent" ? "rgba(140,23,54,0.08)" : "rgba(74,122,58,0.07)",
                    border: `1px solid ${m.role === "agent" ? "rgba(140,23,54,0.2)" : "rgba(74,122,58,0.22)"}`,
                    fontSize: 13, lineHeight: 1.5, color: "var(--text)",
                  }}>
                    {m.message}
                  </div>
                </div>
              ))}
              {!(raw.transcript ?? []).filter((m: {message:string|null}) => m.message).length && (
                <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 40 }}>Sin transcripción disponible.</div>
              )}
            </div>
          )}

          {raw && tab === "analysis" && (() => {
            const analysis = raw.analysis ?? {};
            const dcList: {data_collection_id:string;value:unknown;rationale:string}[] =
              analysis.data_collection_results_list ?? Object.values(analysis.data_collection_results ?? {});
            const evalList: {criteria_id:string;result:string;rationale:string}[] =
              analysis.evaluation_criteria_results_list ?? Object.values(analysis.evaluation_criteria_results ?? {});
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Summary */}
                {analysis.transcript_summary && (
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, marginBottom: 8, letterSpacing: "0.06em" }}>RESUMEN</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>{analysis.transcript_summary}</div>
                  </div>
                )}
                {/* Eval criteria */}
                {evalList.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10, letterSpacing: "0.06em" }}>CRITERIOS DE EVALUACIÓN</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {evalList.map((e, i) => (
                        <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{e.criteria_id}</span>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4,
                              background: e.result === "success" ? "rgba(74,122,58,0.08)" : "rgba(255,101,132,0.1)",
                              color: e.result === "success" ? "var(--success)" : "var(--error)",
                              fontFamily: "monospace",
                            }}>{e.result}</span>
                          </div>
                          {e.rationale && <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{e.rationale}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Data collection */}
                {dcList.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10, letterSpacing: "0.06em" }}>DATOS RECOGIDOS</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {dcList.map((d, i) => (
                        <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <div style={{ fontSize: 11, color: "var(--muted)", minWidth: 120, fontFamily: "monospace" }}>{d.data_collection_id}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: d.value != null ? "var(--text)" : "var(--muted)", wordBreak: "break-word", fontFamily: d.value != null ? "inherit" : "monospace" }}>
                              {d.value != null ? String(d.value) : "null"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {raw && tab === "metadata" && (() => {
            const meta = raw.metadata ?? {};
            const pc = meta.phone_call ?? {};
            const dv = raw.conversation_initiation_client_data?.dynamic_variables ?? {};
            const rows: [string, string][] = [
              ["ID conversación",   raw.conversation_id ?? "—"],
              ["Agente",            raw.agent_name ?? raw.agent_id ?? "—"],
              ["Estado",            raw.status ?? "—"],
              ["Inicio",            meta.start_time_unix_secs ? new Date(meta.start_time_unix_secs * 1000).toLocaleString("es-ES") : "—"],
              ["Duración total",    fmtSecs(meta.call_duration_secs ?? 0)],
              ["Timbre",            meta.accepted_time_unix_secs && meta.start_time_unix_secs ? `${meta.accepted_time_unix_secs - meta.start_time_unix_secs}s` : "—"],
              ["Finalización",      meta.termination_reason ?? "—"],
              ["Dirección",         pc.direction ?? "—"],
              ["Número agente",     pc.agent_number ?? "—"],
              ["Número externo",    pc.external_number ?? dv.system__caller_id ?? "—"],
              ["Tipo llamada",      pc.type ?? "—"],
              ["Call SID",          pc.call_sid ?? "—"],
              ["Idioma",            meta.main_language ?? "—"],
              ["Fuente inicio",     meta.conversation_initiation_source ?? "—"],
              ["Zona horaria",      meta.timezone ?? "—"],
              ["Modelo LLM",        Object.keys(meta.charging?.llm_usage?.initiated_generation?.model_usage ?? {}).join(", ") || "—"],
              ["Coste (créditos)",  meta.charging?.cost != null ? String(meta.charging.cost) : "—"],
            ];
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
                {rows.map(([label, value], i) => (
                  <div key={i} style={{ display: "flex", gap: 0, background: i % 2 === 0 ? "var(--surface)" : "rgba(234,217,208,0.4)" }}>
                    <div style={{ padding: "9px 14px", minWidth: 160, fontSize: 11, color: "var(--muted)", fontWeight: 500, borderRight: "1px solid var(--border)", flexShrink: 0 }}>{label}</div>
                    <div style={{ padding: "9px 14px", fontSize: 12, color: "var(--text)", fontFamily: "monospace", wordBreak: "break-all" }}>{value}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {raw && tab === "raw" && (
            <div style={{ position: "relative" }}>
              <button onClick={() => navigator.clipboard.writeText(JSON.stringify(raw, null, 2))}
                style={{ position: "absolute", top: 8, right: 8, background: "rgba(140,23,54,0.18)", border: "1px solid rgba(108,99,255,0.3)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "var(--accent)", fontSize: 11, zIndex: 1 }}>
                Copiar
              </button>
              <pre style={{ margin: 0, padding: 16, background: "rgba(0,0,0,0.4)", borderRadius: 10, fontSize: 11, lineHeight: 1.5, color: "var(--muted)", whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "monospace", border: "1px solid var(--border)" }}>
                {JSON.stringify(raw, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Queue Manager ─────────────────────────────────────────────────────────────
function QueueManager({ queues, agents, agentCodes, onQueuesChange, onCodeSaved }: {
  queues: Queue[]; agents: Agent[]; agentCodes: Record<string, string>;
  onQueuesChange: () => void; onCodeSaved: (agentId: string, code: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState<string | null>(null); // id of queue being saved
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [localCodes, setLocalCodes] = useState<Record<string, string>>(agentCodes);
  const [error, setError] = useState("");

  async function saveCode(agentId: string) {
    const code = (localCodes[agentId] ?? "").trim();
    setSavingCode(agentId);
    try { await apiSetAgentCode(agentId, code); onCodeSaved(agentId, code); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Error guardando código"); }
    finally { setSavingCode(null); }
  }

  async function addQueue() {
    if (!newName.trim()) return;
    setSaving("new"); setError("");
    try {
      await apiCreateQueue(newName);
      setNewName(""); onQueuesChange();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(null); }
  }

  async function deleteQueue(id: string) {
    setSaving(id); setError("");
    try { await apiDeleteQueue(id); onQueuesChange(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(null); }
  }

  async function renameQueue(id: string) {
    if (!editName.trim()) return;
    setSaving(id); setError("");
    try { await apiUpdateQueue(id, { name: editName.trim() }); setEditingId(null); onQueuesChange(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(null); }
  }

  async function toggleAgent(queue: Queue, agentId: string) {
    setSaving(queue.id); setError("");
    const has = queue.agent_ids.includes(agentId);
    const newIds = has ? queue.agent_ids.filter(id => id !== agentId) : [...queue.agent_ids, agentId];
    try { await apiUpdateQueue(queue.id, { agent_ids: newIds }); onQueuesChange(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(null); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {error && (
        <div style={{ padding: "12px 16px", background: "rgba(140,23,54,0.06)", border: "1px solid rgba(255,101,132,0.2)", borderRadius: 8, color: "var(--error)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <XCircle size={14} /> {error}
        </div>
      )}

      {/* Create */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Nueva cola</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>
          El nombre de la cola aparecerá en la columna <strong style={{ color: "var(--text)" }}>Cola</strong> del Excel exportado. Los datos se guardan en Supabase.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input className="input" placeholder="Ej: Soporte técnico, Ventas, Recepción..." value={newName}
            onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addQueue()} style={{ flex: 1 }} />
          <button className="btn-primary" onClick={addQueue} disabled={!newName.trim() || saving === "new"}
            style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            {saving === "new" ? <Loader2 size={14} className="spinner" /> : <Plus size={14} />} Crear cola
          </button>
        </div>
      </div>

      {/* Códigos de Atendida */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <Hash size={15} style={{ color: "var(--accent)" }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Códigos de Atendida</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              Código que aparecerá en la columna <strong style={{ color: "var(--text)" }}>Atendida</strong> del Excel para cada agente.
            </div>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          {agents.length === 0
            ? <div style={{ fontSize: 12, color: "var(--muted)" }}>No hay agentes cargados.</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {agents.map(agent => (
                  <div key={agent.agent_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <Bot size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />{agent.name}
                      </div>
                    </div>
                    <input className="input" placeholder="Ej: AGT01, EXT200..." value={localCodes[agent.agent_id] ?? ""}
                      onChange={e => setLocalCodes(p => ({ ...p, [agent.agent_id]: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && saveCode(agent.agent_id)}
                      style={{ width: 160, fontFamily: "'DM Mono', monospace", fontSize: 12 }} />
                    <button onClick={() => saveCode(agent.agent_id)} disabled={savingCode === agent.agent_id}
                      style={{ background: "var(--accent)", border: "none", borderRadius: 6, padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, color: "white", fontSize: 12, whiteSpace: "nowrap" }}>
                      {savingCode === agent.agent_id ? <Loader2 size={12} className="spinner" color="white" /> : <Check size={12} />}
                      Guardar
                    </button>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      {queues.length === 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 40, textAlign: "center", color: "var(--muted)" }}>
          <Layers size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>No hay colas creadas todavía.</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Crea una cola y asigna agentes para exportar con el nombre correcto.</div>
        </div>
      )}

      {queues.map(queue => {
        const isSaving = saving === queue.id;
        return (
          <div key={queue.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", opacity: isSaving ? 0.7 : 1, transition: "opacity 0.2s" }}>
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              {editingId === queue.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                  <input className="input" value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") renameQueue(queue.id); if (e.key === "Escape") setEditingId(null); }}
                    style={{ maxWidth: 280 }} autoFocus />
                  <button onClick={() => renameQueue(queue.id)} disabled={isSaving}
                    style={{ background: "var(--success)", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", display: "flex" }}>
                    {isSaving ? <Loader2 size={13} className="spinner" color="white" /> : <Check size={13} color="white" />}
                  </button>
                  <button onClick={() => setEditingId(null)} style={{ background: "rgba(140,23,54,0.08)", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", display: "flex" }}>
                    <X size={13} color="var(--error)" />
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {isSaving && <Loader2 size={13} className="spinner" style={{ color: "var(--accent)" }} />}
                  <Layers size={15} style={{ color: "var(--accent)" }} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{queue.name}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
                    {queue.agent_ids.length} agente{queue.agent_ids.length !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
              {editingId !== queue.id && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { setEditingId(queue.id); setEditName(queue.name); }}
                    style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: "var(--muted)", display: "flex" }}>
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => deleteQueue(queue.id)} disabled={isSaving}
                    style={{ background: "rgba(140,23,54,0.06)", border: "1px solid rgba(255,101,132,0.2)", borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: "var(--error)", display: "flex" }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Agent assignment */}
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12, letterSpacing: "0.05em" }}>
                AGENTES ASIGNADOS — haz clic para asignar / desasignar
              </div>
              {agents.length === 0
                ? <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertCircle size={13} /> Recarga los agentes usando el botón del header.
                  </div>
                : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {agents.map(agent => {
                      const assigned = queue.agent_ids.includes(agent.agent_id);
                      const otherQ = !assigned && getQueueForAgent(queues, agent.agent_id);
                      return (
                        <button key={agent.agent_id} onClick={() => toggleAgent(queue, agent.agent_id)} disabled={isSaving}
                          title={otherQ ? `Ya en: ${otherQ.name}` : ""}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid", transition: "all 0.15s", cursor: "pointer", fontSize: 12,
                            borderColor: assigned ? "var(--success)" : otherQ ? "var(--warning)" : "var(--border)",
                            background: assigned ? "rgba(74,122,58,0.08)" : otherQ ? "rgba(160,104,26,0.08)" : "rgba(234,217,208,0.4)",
                            color: assigned ? "var(--success)" : otherQ ? "var(--warning)" : "var(--text)" }}>
                          {assigned ? <Check size={12} /> : <Bot size={12} style={{ color: "var(--muted)" }} />}
                          {agent.name}
                          {otherQ && <span style={{ fontSize: 10, opacity: 0.8 }}>({otherQ.name})</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [agentCodes, setAgentCodes] = useState<Record<string, string>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("datos");
  const [dataTab, setDataTab] = useState<"tabla" | "graficos">("tabla");
  const [grouping, setGrouping] = useState<Grouping>("dia");
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [dateFrom, setDateFrom] = useState(presetDates("30d").from);
  const [dateTo, setDateTo] = useState(presetDates("30d").to);
  const [hourFrom, setHourFrom] = useState<number>(0);
  const [hourTo, setHourTo] = useState<number>(23);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingQueues, setLoadingQueues] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [fetched, setFetched] = useState(false);
  const [panelConvId, setPanelConvId] = useState<string | null>(null);
  const stats = useStats(conversations, grouping);
  const filteredConversations = useMemo(() => {
    if (hourFrom === 0 && hourTo === 23) return conversations;
    return conversations.filter(c => {
      const h = new Date(c.start_time_unix_secs * 1000).getHours();
      return h >= hourFrom && h <= hourTo;
    });
  }, [conversations, hourFrom, hourTo]);
  const filteredStats = useStats(filteredConversations, grouping);

  const fetchQueues = useCallback(async () => {
    setLoadingQueues(true);
    try {
      const [qs, codes] = await Promise.all([apiGetQueues(), apiGetAgentCodes()]);
      setQueues(qs);
      setAgentCodes(codes);
    }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Error cargando colas"); }
    finally { setLoadingQueues(false); }
  }, []);

  useEffect(() => {
    fetchQueues();
    loadAgents();
  }, []);

  useEffect(() => {
    if (preset === "7d" || preset === "30d") setGrouping("dia");
    else if (preset === "90d") setGrouping("semana");
  }, [preset]);

  function applyPreset(p: RangePreset) {
    setPreset(p);
    if (p !== "custom") { const d = presetDates(p); setDateFrom(d.from); setDateTo(d.to); }
  }

  const loadAgents = useCallback(async () => {
    setLoadingAgents(true); setError("");
    try { const r = await fetch("/api/agents"); const d = await r.json(); if (!r.ok) throw new Error(d.error); setAgents(d.agents); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Error al cargar agentes"); }
    finally { setLoadingAgents(false); }
  }, []);

  const loadConversations = useCallback(async () => {
    if (!selectedAgent) { setError("Selecciona un agente."); return; }
    setLoadingConvs(true); setError(""); setConversations([]); setSelected(new Set()); setFetched(false);
    try {
      const r = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: selectedAgent.agent_id, dateFrom, dateTo }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      setConversations(d.conversations);
      setSelected(new Set(d.conversations.map((c: ConversationSummary) => c.conversation_id)));
      setFetched(true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoadingConvs(false); }
  }, [selectedAgent, dateFrom, dateTo]);

  const exportExcel = useCallback(async () => {
    if (selected.size === 0) { setError("Selecciona al menos una conversación."); return; }
    const queueName = selectedAgent ? (getQueueForAgent(queues, selectedAgent.agent_id)?.name ?? selectedAgent.name) : "Agente";
    setExporting(true); setError("");
    try {
      const r = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentName: queueName, agentCode: selectedAgent ? (agentCodes[selectedAgent.agent_id] ?? "") : "", conversationIds: Array.from(selected) }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `conversaciones_${queueName.replace(/\s+/g, "_")}_${dateFrom}_${dateTo}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setExporting(false); }
  }, [selectedAgent, queues, selected, dateFrom, dateTo]);

  const toggleSelect = (id: string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(selected.size === conversations.length ? new Set() : new Set(conversations.map(c => c.conversation_id)));
  const allSelected = conversations.length > 0 && selected.size === conversations.length;
  const card = (e?: React.CSSProperties) => ({ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, ...e });
  const selectedQueue = selectedAgent ? getQueueForAgent(queues, selectedAgent.agent_id) : undefined;

  return (
    <div className="gradient-bg min-h-screen">
      <header style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.svg" alt="Activum" style={{ height: 56, width: "auto" }} />
            <div>
              <div className="serif" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "0.02em", color: "var(--text)" }}>Agente IA Dashboard</div>
              <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>Conversaciones · ElevenLabs</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={loadAgents} className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }} disabled={loadingAgents}>
              {loadingAgents ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />} Recargar agentes
            </button>
            <a href="https://elevenlabs.io/app/conversational-ai" target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              ElevenLabs <ExternalLink size={12} />
            </a>
            <button className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }} onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}>
              <LogOut size={13} /> Salir
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6" style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
          {([["datos", TableProperties, "Datos"], ["colas", Layers, "Gestión de Colas"]] as const).map(([tab, Icon, label]) => (
            <button key={tab} onClick={() => setMainTab(tab)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 20px", border: "none", borderBottom: mainTab === tab ? "2px solid var(--accent)" : "2px solid transparent", background: "transparent", color: mainTab === tab ? "var(--accent)" : "var(--muted)", fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" as const, cursor: "pointer", transition: "all 0.15s", marginBottom: -1, fontFamily: "'DM Mono', monospace" }}>
              <Icon size={14} />{label}
              {tab === "colas" && loadingQueues && <Loader2 size={11} className="spinner" style={{ marginLeft: 4 }} />}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {error && (
          <div className="fade-up" style={{ padding: "12px 16px", background: "rgba(140,23,54,0.06)", border: "1px solid rgba(255,101,132,0.2)", borderRadius: 8, color: "var(--error)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <XCircle size={14} /> {error}
          </div>
        )}

        {/* ══ COLAS ══ */}
        {mainTab === "colas" && (
          <QueueManager queues={queues} agents={agents} agentCodes={agentCodes} onQueuesChange={fetchQueues} onCodeSaved={(id, code) => setAgentCodes(p => ({ ...p, [id]: code }))} />
        )}

        {/* ══ DATOS ══ */}
        {mainTab === "datos" && (
          <>
            <div style={card({ padding: 24 })} className="fade-up">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 20, alignItems: "flex-end" }}>
                {/* Agent */}
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6 }}>AGENTE</label>
                  {loadingAgents
                    ? <div style={{ padding: "10px 14px", background: "#FFFFFF", border: "1px solid var(--border)", borderRadius: 8, color: "var(--muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={13} className="spinner" />Cargando agentes...</div>
                    : <AgentDropdown agents={agents} value={selectedAgent} onChange={a => { setSelectedAgent(a); setFetched(false); setConversations([]); }} />
                  }
                </div>

                {/* Range */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--muted)" }}>RANGO</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["7d", "30d", "90d", "custom"] as RangePreset[]).map(p => (
                      <Pill key={p} label={p === "custom" ? "Custom" : p} active={preset === p} onClick={() => applyPreset(p)} />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ position: "relative", flex: 1 }}>
                      <Calendar size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }} />
                      <input className="input" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPreset("custom"); }} style={{ paddingLeft: 28, fontSize: 12 }} />
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>→</span>
                    <div style={{ position: "relative", flex: 1 }}>
                      <Calendar size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }} />
                      <input className="input" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPreset("custom"); }} style={{ paddingLeft: 28, fontSize: 12 }} />
                    </div>
                  </div>
                </div>

                <button className="btn-primary" onClick={loadConversations} disabled={loadingConvs || !selectedAgent}
                  style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                  {loadingConvs ? <Loader2 size={14} className="spinner" /> : <Search size={14} />}
                  {loadingConvs ? "Buscando..." : "Buscar"}
                </button>
              </div>
              {/* Queue info — always rendered to avoid layout shift */}
              <div style={{ marginTop: 8, fontSize: 11, display: "flex", alignItems: "center", gap: 6, height: 18 }}>
                {selectedAgent && (selectedQueue
                  ? <><Layers size={11} style={{ color: "var(--accent)" }} /><span style={{ color: "var(--muted)" }}>Cola:</span><span style={{ color: "var(--accent)", fontWeight: 600 }}>{selectedQueue.name}</span><span style={{ color: "var(--muted)" }}>→ aparecerá en el Excel</span></>
                  : <><AlertCircle size={11} style={{ color: "var(--warning)" }} /><span style={{ color: "var(--warning)" }}>Sin cola asignada — se usará el nombre del agente.</span><button onClick={() => setMainTab("colas")} style={{ background: "none", border: "none", color: "var(--warning)", cursor: "pointer", textDecoration: "underline", fontSize: 11, padding: 0 }}>Asignar cola →</button></>
                )}
              </div>
            </div>

            {fetched && filteredConversations.length > 0 && filteredStats && (
              <>
                <div className="fade-up" style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 12 }}>
                  {[
                    { label: "TOTAL LLAMADAS", value: filteredConversations.length, color: "var(--accent)" },
                    { label: "COMPLETADAS", value: filteredStats.completed, color: "var(--success)" },
                    { label: "TASA ÉXITO", value: `${Math.round(filteredStats.completed / filteredConversations.length * 100)}%`, color: "var(--success)" },
                    { label: "DURACIÓN MEDIA", value: fmt(filteredStats.avgDur), color: "var(--accent)" },
                    { label: "DURACIÓN MÁXIMA", value: fmt(filteredStats.maxDur), color: "var(--warning)" },
                    { label: "TOTAL MENSAJES", value: filteredStats.totalMessages.toLocaleString("es-ES"), color: "var(--text)" },
                    { label: "MENSAJES MEDIO", value: filteredStats.avgMessages, color: "var(--muted)" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={card({ padding: "16px 18px" })}>
                      <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em", marginBottom: 8, fontFamily: "monospace" }}>{label}</div>
                      <div style={{ fontSize: 22, fontWeight: 600, color, fontFamily: "'Playfair Display', serif" }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 4, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 4 }}>
                    {([["tabla", TableProperties, "Tabla"], ["graficos", BarChart2, "Gráficos"]] as const).map(([tab, Icon, label]) => (
                      <button key={tab} onClick={() => setDataTab(tab)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.2s", background: dataTab === tab ? "var(--accent)" : "transparent", color: dataTab === tab ? "white" : "var(--muted)" }}>
                        <Icon size={14} />{label}
                      </button>
                    ))}
                  </div>
                  {dataTab === "graficos" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>AGRUPAR POR</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {(["hora", "dia", "semana", "mes"] as Grouping[]).map(g => (
                          <Pill key={g} label={g.charAt(0).toUpperCase() + g.slice(1)} active={grouping === g} onClick={() => setGrouping(g)} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>HORA</span>
                    <select className="input" value={hourFrom} onChange={e => setHourFrom(Number(e.target.value))} style={{ width: 70, padding: "5px 8px", fontSize: 12 }}>
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
                    </select>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                    <select className="input" value={hourTo} onChange={e => setHourTo(Number(e.target.value))} style={{ width: 70, padding: "5px 8px", fontSize: 12 }}>
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2,"0")}:59</option>)}
                    </select>
                    {(hourFrom !== 0 || hourTo !== 23) && (
                      <button onClick={() => { setHourFrom(0); setHourTo(23); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 11, padding: "2px 6px", borderRadius: 2 }}>✕ reset</button>
                    )}
                  </div>
                </div>

                {dataTab === "graficos" && (
                  <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <div style={card({ padding: 24 })}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Llamadas por {grouping}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 20 }}>Volumen de conversaciones</div>
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart data={filteredStats.groupedData}>
                            <defs><linearGradient id="gLL" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8C1736" stopOpacity={0.15}/><stop offset="95%" stopColor="#8C1736" stopOpacity={0}/></linearGradient></defs>
                            <CartesianGrid stroke="#1e1e2e" strokeDasharray="3 3"/>
                            <XAxis dataKey="date" tick={{ fill:"#6b6b8a", fontSize:10 }} axisLine={false} tickLine={false}/>
                            <YAxis tick={{ fill:"#6b6b8a", fontSize:10 }} axisLine={false} tickLine={false}/>
                            <Tooltip content={<ChartTooltip unit=" llamadas"/>}/>
                            <Area type="monotone" dataKey="llamadas" stroke="#8C1736" strokeWidth={2} fill="url(#gLL)"/>
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={card({ padding: 24 })}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Duración media por {grouping}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 20 }}>Minutos de media</div>
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={filteredStats.groupedData}>
                            <CartesianGrid stroke="#1e1e2e" strokeDasharray="3 3"/>
                            <XAxis dataKey="date" tick={{ fill:"#6b6b8a", fontSize:10 }} axisLine={false} tickLine={false}/>
                            <YAxis tick={{ fill:"#6b6b8a", fontSize:10 }} axisLine={false} tickLine={false} unit="m"/>
                            <Tooltip content={<ChartTooltip unit="m"/>}/>
                            <Line type="monotone" dataKey="durMedia" stroke="#22d3a3" strokeWidth={2} dot={{ fill:"#22d3a3", r:3 }} activeDot={{ r:5 }}/>
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
                      <div style={card({ padding: 24 })}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Llamadas por hora</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 20 }}>Distribución horaria</div>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={filteredStats.hourData}>
                            <CartesianGrid stroke="#1e1e2e" strokeDasharray="3 3" vertical={false}/>
                            <XAxis dataKey="hora" tick={{ fill:"#6b6b8a", fontSize:9 }} axisLine={false} tickLine={false} interval={2}/>
                            <YAxis tick={{ fill:"#6b6b8a", fontSize:10 }} axisLine={false} tickLine={false}/>
                            <Tooltip content={<ChartTooltip unit=" llamadas"/>}/>
                            <Bar dataKey="llamadas" radius={[4,4,0,0]}>{filteredStats.hourData.map((e,i)=>{ const mx=Math.max(...filteredStats.hourData.map(d=>d.llamadas)); return <Cell key={i} fill={e.llamadas===mx&&mx>0?"#8C1736":"#EAD9D0"}/>; })}</Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={card({ padding: 24 })}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Estado</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>Resultado llamadas</div>
                        <ResponsiveContainer width="100%" height={160}>
                          <PieChart><Pie data={filteredStats.statusData} dataKey="value" cx="50%" cy="50%" outerRadius={65} innerRadius={35} paddingAngle={3}>
                            {filteredStats.statusData.map((e,i)=><Cell key={i} fill={STATUS_COLORS[e.name]??COLORS[i%COLORS.length]}/>)}
                          </Pie><Tooltip content={<ChartTooltip unit=" llamadas"/>}/></PieChart>
                        </ResponsiveContainer>
                        <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:8 }}>
                          {filteredStats.statusData.map((s,i)=>(
                            <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", fontSize:11 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={{ width:8, height:8, borderRadius:"50%", background:STATUS_COLORS[s.name]??COLORS[i%COLORS.length], display:"inline-block" }}/><span style={{ color:"var(--muted)" }}>{s.name}</span></div>
                              <span style={{ fontFamily:"monospace" }}>{s.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={card({ padding: 24 })}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Duración</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>Por rangos</div>
                        <ResponsiveContainer width="100%" height={160}>
                          <BarChart data={filteredStats.durData} layout="vertical">
                            <XAxis type="number" tick={{ fill:"#6b6b8a", fontSize:9 }} axisLine={false} tickLine={false}/>
                            <YAxis type="category" dataKey="name" tick={{ fill:"#6b6b8a", fontSize:10 }} axisLine={false} tickLine={false} width={36}/>
                            <Tooltip content={<ChartTooltip unit=" llamadas"/>}/>
                            <Bar dataKey="value" radius={[0,4,4,0]}>{filteredStats.durData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar>
                          </BarChart>
                        </ResponsiveContainer>
                        <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:8 }}>
                          {filteredStats.durData.map((d,i)=>(
                            <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", fontSize:11 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={{ width:8, height:8, borderRadius:2, background:COLORS[i%COLORS.length], display:"inline-block" }}/><span style={{ color:"var(--muted)" }}>{d.name}</span></div>
                              <span style={{ fontFamily:"monospace" }}>{d.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* Messages distribution chart */}
                    <div style={card({ padding: 24 })}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Distribución de mensajes</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 20 }}>Nº de conversaciones por volumen de mensajes</div>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={filteredStats.msgData} barCategoryGap="30%">
                          <CartesianGrid stroke="rgba(200,180,154,0.2)" strokeDasharray="3 3" vertical={false}/>
                          <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false}/>
                          <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false}/>
                          <Tooltip content={<ChartTooltip unit=" conversaciones"/>}/>
                          <Bar dataKey="value" radius={[4,4,0,0]}>
                            {filteredStats.msgData.map((e, i) => {
                              const mx = Math.max(...filteredStats.msgData.map(d => d.value));
                              return <Cell key={i} fill={e.value === mx && mx > 0 ? "#8C1736" : "#C8B49A"}/>;
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
                        {filteredStats.msgData.map((d, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: d.value === Math.max(...filteredStats.msgData.map(x => x.value)) && d.value > 0 ? "#8C1736" : "#C8B49A", display: "inline-block" }}/>
                            <span style={{ color: "var(--muted)" }}>{d.name} msg</span>
                            <span style={{ fontFamily: "monospace", color: "var(--text)" }}>{d.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {dataTab === "tabla" && (
                  <div style={card({ overflow: "hidden" })} className="fade-up">
                    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="checkbox" checked={filteredConversations.length > 0 && filteredConversations.every(c => selected.has(c.conversation_id))} onChange={toggleAll} style={{ accentColor: "var(--accent)", width: 15, height: 15 }} />
                        <span style={{ fontSize: 13, color: "var(--muted)" }}>{selected.size} de {filteredConversations.length} seleccionadas</span>
                      </div>
                      <button className="btn-success" onClick={exportExcel} disabled={exporting || selected.size === 0} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {exporting ? <Loader2 size={14} className="spinner" /> : <Download size={14} />}
                        {exporting ? "Exportando..." : `Exportar ${selected.size} a Excel`}
                      </button>
                    </div>
                    <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
                      <table className="data-table">
                        <thead style={{ position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
                          <tr><th style={{ width: 40 }}></th><th>Fecha</th><th>Hora</th><th>Cola / Agente</th><th>Llamante</th><th>Llamado</th><th>Duración</th><th>T.Timbre</th><th>Mensajes</th><th>Estado</th><th>Finalizado</th><th>ID</th></tr>
                        </thead>
                        <tbody>
                          {conversations.map(c => {
                            const dt = new Date(c.start_time_unix_secs * 1000);
                            const q = getQueueForAgent(queues, c.agent_id);
                            return (
                              <tr key={c.conversation_id} style={{ cursor: "pointer" }} onClick={() => setPanelConvId(c.conversation_id)}>
                                <td><input type="checkbox" checked={selected.has(c.conversation_id)} onChange={() => toggleSelect(c.conversation_id)} onClick={e => e.stopPropagation()} style={{ accentColor: "var(--accent)", width: 14, height: 14 }} /></td>
                                <td className="mono" style={{ fontSize: 12 }}>{dt.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                                <td className="mono" style={{ fontSize: 12 }}>{dt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</td>
                                <td><div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                  {q && <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>{q.name}</span>}
                                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{agents.find(a => a.agent_id === c.agent_id)?.name ?? c.agent_id}</span>
                                </div></td>
                                <td className="mono" style={{ fontSize: 12 }}>
                                  {c.caller_phone
                                    ? <span>{c.caller_phone}</span>
                                    : <span style={{ color: "var(--muted)" }}>—</span>}
                                </td>
                                <td className="mono" style={{ fontSize: 12 }}>
                                  {c.called_phone
                                    ? <span>{c.called_phone}</span>
                                    : <span style={{ color: "var(--muted)" }}>—</span>}
                                </td>
                                <td className="mono" style={{ fontSize: 12 }}>{fmt(c.call_duration_secs)}</td>
                                <td className="mono" style={{ fontSize: 12 }}>
                                  {c.ring_secs > 0 ? `${c.ring_secs}s` : <span style={{ color: "var(--muted)" }}>—</span>}
                                </td>
                                <td><div style={{ display: "flex", alignItems: "center", gap: 4 }}><MessageSquare size={12} style={{ color: "var(--muted)" }} /><span className="mono" style={{ fontSize: 12 }}>{c.message_count}</span></div></td>
                                <td>{(() => { const s = c.status?.toLowerCase(); if (s==="done"||s==="completed") return <span className="tag tag-done">✓ Completada</span>; if (s==="processing") return <span className="tag tag-processing">⟳ Procesando</span>; if (s==="failed"||s==="error") return <span className="tag tag-failed">✗ Error</span>; return <span className="tag tag-default">{c.status}</span>; })()}</td>
                                <td>{(() => { const e = c.ended_by; if (!e || e === "—") return <span style={{ color: "var(--muted)" }}>—</span>; if (e === "agent") return <span className="tag tag-done">agent</span>; if (e === "caller") return <span className="tag tag-processing">caller</span>; if (e === "abandon") return <span className="tag tag-failed">abandon</span>; return <span className="tag tag-default">{e}</span>; })()}</td>
                                <td className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{c.conversation_id.slice(0,20)}…</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
            {fetched && conversations.length === 0 && !loadingConvs && (
              <div style={card({ padding: 48, textAlign: "center" })} className="fade-up">
                <MessageSquare size={32} style={{ margin: "0 auto 12px", opacity: 0.3, color: "var(--muted)" }} />
                <div style={{ fontSize: 14, color: "var(--muted)" }}>No hay conversaciones en ese rango.</div>
              </div>
            )}
            {!fetched && !loadingConvs && (
              <div style={card({ padding: 48, textAlign: "center" })} className="fade-up">
                <Search size={32} style={{ margin: "0 auto 12px", opacity: 0.3, color: "var(--muted)" }} />
                <div style={{ fontSize: 14, color: "var(--muted)" }}>Selecciona un agente y pulsa Buscar.</div>
              </div>
            )}
          </>
        )}
      </main>
      {panelConvId && (
        <ConversationPanel
          convId={panelConvId}
          agentName={selectedAgent?.name ?? "Agente"}
          onClose={() => setPanelConvId(null)}
        />
      )}
      <footer style={{ borderTop: "1px solid var(--border)", padding: "16px 24px", textAlign: "center", fontSize: 11, color: "var(--muted)", marginTop: 32 }}>
        <span className="serif" style={{ fontSize: 13 }}>Activum</span> <span style={{ color: "var(--border)" }}>·</span> Colas guardadas en Supabase
      </footer>
    </div>
  );
}// ── Agent Dropdown ────────────────────────────────────────────────────────────
