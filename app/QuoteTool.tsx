"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateQuote } from "../lib/calculate";
import { defaultQuote } from "../lib/defaults";
import type { AppSettings, QuoteInputs, QuoteRecord, Role, SystemNotification, Viewer } from "../lib/model";

type UserRow = { userId: string; email: string; displayName: string; role: Role; createdAt: string };
type SessionData = { viewer: Viewer; settings: AppSettings; quotes: QuoteRecord[]; users: UserRow[]; notifications: SystemNotification[] };
type Tab = "quote" | "history" | "settings" | "users";

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const num = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;
const notificationTime = (value: string) => {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(date);
};
const today = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const freshQuote = (): QuoteInputs => ({
  ...defaultQuote,
  date: today(),
  manualCosts: { ...defaultQuote.manualCosts },
});

export function QuoteTool() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [inputs, setInputs] = useState<QuoteInputs>(() => freshQuote());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("quote");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [demoRole, setDemoRole] = useState<Role>("admin");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchSession = async () => {
    const response = await fetch("/api/session", { cache: "no-store" });
    const data = await response.json() as SessionData & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Unable to load data");
    return data;
  };

  const loadSession = async () => {
    const data = await fetchSession();
    setSession(data);
    setSettingsDraft(structuredClone(data.settings));
    setDemoRole(data.viewer.role);
  };

  useEffect(() => {
    void fetchSession()
      .then((data) => {
        setSession(data);
        setSettingsDraft(structuredClone(data.settings));
        setDemoRole(data.viewer.role);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load data"));
  }, []);

  const settings = session?.settings;
  const result = useMemo(() => settings ? calculateQuote(inputs, settings) : null, [inputs, settings]);
  const filteredQuotes = useMemo(() => {
    const query = quoteSearch.trim().toLowerCase();
    if (!query) return session?.quotes ?? [];
    return (session?.quotes ?? []).filter((quote) => [
      quote.projectName,
      quote.payload.customerName,
      quote.payload.address,
      quote.payload.phone,
      quote.payload.initiator,
    ].some((value) => String(value ?? "").toLowerCase().includes(query)));
  }, [quoteSearch, session?.quotes]);
  const role = session?.viewer.isLocalDemo ? demoRole : session?.viewer.role ?? "user";
  const isAdmin = role === "admin";

  const setField = <K extends keyof QuoteInputs>(key: K, value: QuoteInputs[K]) => {
    setInputs((current) => ({ ...current, [key]: value }));
  };
  const setManualCost = (key: keyof QuoteInputs["manualCosts"], value: number) => {
    setInputs((current) => ({ ...current, manualCosts: { ...current.manualCosts, [key]: value } }));
  };

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2800);
  };

  const saveQuote = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: quoteId, payload: inputs }),
      });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? "Unable to save quote");
      setQuoteId(data.id);
      await loadSession();
      flash("Quote saved");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to save quote");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!settingsDraft || !isAdmin) return;
    setBusy(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: settingsDraft }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save settings");
      await loadSession();
      flash("Base data published");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to save settings");
    } finally {
      setBusy(false);
    }
  };

  if (!session || !settings || !result || !settingsDraft) {
    return (
      <main className="loading-screen">
        <div className="brand-mark large">E3</div>
        <div><strong>E3 Quoter</strong><p>{message || "Syncing the quote model…"}</p></div>
      </main>
    );
  }

  const statusCopy = {
    healthy: { label: "Healthy", detail: `Meets the ${pct(settings.thresholds.target)} target`, icon: "✓" },
    review: { label: "Review", detail: "Below target but within the review range", icon: "!" },
    approval: { label: "Senior approval", detail: `Below the ${pct(settings.thresholds.approval)} approval threshold`, icon: "↑" },
  }[result.status];

  const navItems: Array<{ id: Tab; label: string; glyph: string; admin?: boolean }> = [
    { id: "quote", label: "Quote calculator", glyph: "⌁" },
    { id: "history", label: "My quotes", glyph: "◷" },
    { id: "settings", label: "Base data", glyph: "◇", admin: true },
    { id: "users", label: "User access", glyph: "◎", admin: true },
  ];
  const latestNotification = session.notifications?.[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">E3</span><span><b>E3 Quoter</b></span></div>
        <nav>
          {navItems.filter((item) => !item.admin || isAdmin).map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              <span>{item.glyph}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className={`model-note notification-card ${latestNotification ? "has-update" : ""}`}>
          <span className="dot" />
          <div>
            <b>{latestNotification?.message ?? "No new updates"}</b>
            <small>{latestNotification ? `${latestNotification.createdBy} · ${notificationTime(latestNotification.createdAt)}` : "Admin changes will appear here"}</small>
          </div>
        </div>
        <div className="sidebar-user">
          <div className="avatar">{session.viewer.displayName.slice(0, 1).toUpperCase()}</div>
          <div><b>{session.viewer.displayName}</b><small>{isAdmin ? "Administrator" : "Standard user"}</small></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{tab === "quote" ? "Quote Table" : tab === "history" ? "My quotes" : tab === "settings" ? "Base data management" : "Users & access"}</h1>
          </div>
          <div className="top-actions">
            {session.viewer.isLocalDemo && (
              <label className="demo-switch">Local demo
                <select value={demoRole} onChange={(event) => { setDemoRole(event.target.value as Role); setTab("quote"); }}>
                  <option value="admin">Administrator view</option><option value="user">Standard user view</option>
                </select>
              </label>
            )}
            <button className="ghost-btn" onClick={() => { setInputs(freshQuote()); setQuoteId(null); }}>Reset</button>
            {tab === "quote" && <button className="primary-btn" disabled={busy} onClick={saveQuote}>{busy ? "Saving…" : "Save quote"}</button>}
            {tab === "settings" && isAdmin && <button className="primary-btn" disabled={busy} onClick={saveSettings}>{busy ? "Publishing…" : "Publish changes"}</button>}
          </div>
        </header>

        {tab === "quote" && (
          <div className="quote-layout">
            <div className="form-column">
              <section className="panel project-panel">
                <div className="section-heading"><div><span>01</span><h2>Project information</h2></div><small>Standard users can edit orange fields</small></div>
                <div className="project-columns">
                  <div className="project-column customer-details">
                    <div className="column-label">Customer details</div>
                    <Field label="Date"><input type="date" value={inputs.date} onChange={(e) => setField("date", e.target.value)} /></Field>
                    <Field label="Customer name"><input value={inputs.customerName} placeholder="Enter customer name" onChange={(e) => setField("customerName", e.target.value)} /></Field>
                    <Field label="Phone"><input type="tel" value={inputs.phone ?? ""} placeholder="Enter phone number" onChange={(e) => setField("phone", e.target.value)} /></Field>
                    <Field label="Project address"><input value={inputs.address} placeholder="Enter installation address" onChange={(e) => setField("address", e.target.value)} /></Field>
                    <Field label="E³ Energy Initiator"><input value={inputs.initiator} placeholder="Enter owner name" onChange={(e) => setField("initiator", e.target.value)} /></Field>
                  </div>
                  <div className="project-column system-details">
                    <div className="column-label">System configuration</div>
                    <Field label="PV system size"><NumberInput value={inputs.pvSize} suffix="kW" onChange={(v) => setField("pvSize", v)} /></Field>
                    <Field label="Inverter"><select value={inputs.inverter} onChange={(e) => setField("inverter", e.target.value)}>{settings.inverters.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field>
                    <Field label="Battery size"><select value={inputs.batteryKwh} onChange={(e) => setField("batteryKwh", num(e.target.value))}>{settings.batteries.map((item) => <option key={item.kwh} value={item.kwh}>{item.kwh} kWh</option>)}</select></Field>
                  </div>
                </div>
              </section>

              <section className="panel">
                <div className="section-heading"><div><span>02</span><h2>Quote breakdown</h2></div><small>Sales price = cost × (1 + margin)</small></div>
                <div className="quote-funding-layout">
                  <div className="quote-lines">
                    <div className="embedded-heading"><b>Quote items</b><small>Cost, margin and sales price</small></div>
                    <div className="table-wrap">
                      <table className="quote-table">
                        <thead><tr><th>Item</th><th>Cost (excl. GST)</th><th>Margin</th><th>Sales price (excl. GST)</th></tr></thead>
                        <tbody>
                          {result.lineItems.map((item) => {
                            const manualKey = item.key as keyof QuoteInputs["manualCosts"];
                            return (
                              <tr key={item.key}>
                                <td><b>{item.label}</b>{item.note && <small>{item.note}</small>}</td>
                                <td>{item.editableByUser ? <NumberInput compact value={item.cost} prefix="$" onChange={(v) => setManualCost(manualKey, v)} /> : <span className="locked-value">{money.format(item.cost)}</span>}</td>
                                <td><span className="margin-chip">{pct(item.margin)}</span></td>
                                <td><b>{money.format(item.salesPrice)}</b></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="funding-panel">
                    <div className="embedded-heading"><b>Rebates & customer balance</b><small>Discounts must be negative</small></div>
                    <div className="funding-grid">
                      <Readout label="Solar STC" value={money.format(result.solarStc)} detail={`${result.solarCertificates} certificates × ${money.format(settings.solarStcUnitPrice)}`} />
                      <Readout label="Battery STC" value={money.format(result.batteryStc)} detail={`${result.batteryCertificates} certificates × ${money.format(settings.batteryStcUnitPrice)}`} />
                      <Field label="Solar VIC Rebate"><NumberInput prefix="$" value={inputs.solarVicRebate} onChange={(v) => setField("solarVicRebate", Math.max(0, v))} /></Field>
                      <Field label="Solar VIC Interest Free Loan"><NumberInput prefix="$" value={inputs.solarVicLoan} onChange={(v) => setField("solarVicLoan", Math.max(0, v))} /></Field>
                      <Field label="Discount"><NumberInput prefix="$" value={inputs.discount} onChange={(v) => setField("discount", Math.min(0, v))} /></Field>
                      <Field label="Customer balance (incl. GST)"><NumberInput prefix="$" value={inputs.customerBalance} onChange={(v) => setField("customerBalance", v)} /></Field>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <aside className="summary-column">
              <section className={`status-card ${result.status}`}>
                <div className="status-top"><span className="status-icon">{statusCopy.icon}</span><span>{statusCopy.label}</span></div>
                <div className="margin-number">{pct(result.grossMarginRate)}</div>
                <p>{statusCopy.detail}</p>
                <div className="meter"><i style={{ width: `${Math.min(100, Math.max(0, result.grossMarginRate / settings.thresholds.target * 100))}%` }} /></div>
                <div className="meter-labels"><span>{pct(settings.thresholds.approval)}</span><span>Target {pct(settings.thresholds.target)}</span></div>
              </section>

              <section className="panel metric-panel">
                <div className="section-heading compact"><div><h2>Margin summary</h2></div><span className="live-pill"><i /> Live</span></div>
                <Metric label="Total received (excl. GST)" value={money.format(result.totalReceivedExGst)} />
                <Metric label="Total cost (excl. GST)" value={money.format(result.totalCostExGst)} />
                <Metric label="Net GST" value={money.format(result.netGst)} muted />
                <Metric label="Gross Margin" value={money.format(result.grossMargin)} accent />
              </section>

              <section className="target-card">
                <span className="target-kicker">Reach {pct(settings.thresholds.target)} margin</span>
                <h3>{money.format(result.targetRequiredBalance)}</h3>
                <p>Required customer balance (incl. GST)</p>
                <div className={result.targetGap > 0 ? "gap bad" : "gap good"}>
                  <span>{result.targetGap > 0 ? "Shortfall" : "Above target"}</span><b>{money.format(Math.abs(result.targetGap))}</b>
                </div>
              </section>

              <div className="formula-note"><b>Calculation basis</b><p>STC, GST, cost and margin relationships match the original workbook. The target balance is solved live and no longer relies on an Excel macro.</p></div>
            </aside>
          </div>
        )}

        {tab === "history" && (
          <section className="panel standalone">
            <div className="section-heading"><div><span>◷</span><h2>Recent quotes</h2></div><small>Only your own records are shown</small></div>
            {session.quotes.length === 0 ? <EmptyState /> : (
              <>
                <label className="history-search">
                  <span aria-hidden="true">⌕</span>
                  <input type="search" value={quoteSearch} onChange={(event) => setQuoteSearch(event.target.value)} placeholder="Search by name, address or phone" aria-label="Search saved quotes" />
                  {quoteSearch && <button type="button" onClick={() => setQuoteSearch("")}>Clear</button>}
                </label>
                {filteredQuotes.length === 0 ? (
                  <div className="empty search-empty"><span>⌕</span><h3>No matching quotes</h3><p>Try another customer name, project address or Energy Initiator.</p></div>
                ) : (
                  <div className="history-list">{filteredQuotes.map((quote) => {
                    const calculated = calculateQuote(quote.payload, settings);
                    return <button key={quote.id} onClick={() => { setQuoteId(quote.id); setInputs(quote.payload); setTab("quote"); }}>
                      <span className="history-customer"><b>{quote.projectName}</b><small>{quote.payload.address || "No address entered"}</small><small>{quote.payload.phone || "No phone entered"}</small></span>
                      <span className="history-config"><b>{quote.payload.pvSize || "-"} kW Solar · {quote.payload.batteryKwh || "-"} kWh Battery</b><small>{quote.payload.inverter || "No inverter selected"}</small></span>
                      <span className="history-margin"><b>{money.format(calculated.grossMargin)}</b><small className={`mini-status ${calculated.status}`}>{pct(calculated.grossMarginRate)}</small></span>
                      <span className="chevron">›</span>
                    </button>;
                  })}</div>
                )}
              </>
            )}
          </section>
        )}

        {tab === "settings" && isAdmin && (
          <AdminSettings settings={settingsDraft} onChange={setSettingsDraft} />
        )}

        {tab === "users" && isAdmin && (
          <UsersPanel viewer={session.viewer} users={session.users} onChanged={async () => { await loadSession(); flash("Access updated"); }} />
        )}
      </main>

      {message && <div className="toast">{message}</div>}
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}

function NumberInput({ value, onChange, prefix, suffix, compact }: { value: number; onChange: (value: number) => void; prefix?: string; suffix?: string; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === 0 ? "" : String(value));

  useEffect(() => {
    if (!editing) setDraft(value === 0 ? "" : String(value));
  }, [editing, value]);

  const commit = () => {
    setEditing(false);
    const next = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(next)) {
      setDraft("");
      onChange(0);
      return;
    }
    setDraft(next === 0 ? "" : String(next));
    onChange(next);
  };

  return <div className={`number-input ${compact ? "compact" : ""}`}>
    {prefix && <span>{prefix}</span>}
    <input
      type="text"
      inputMode="decimal"
      value={editing ? draft : value === 0 ? "" : String(value)}
      placeholder="-"
      onFocus={() => { setEditing(true); setDraft(value === 0 ? "" : String(value)); }}
      onChange={(event) => {
        const next = event.target.value;
        if (!/^-?\d*\.?\d*$/.test(next)) return;
        setDraft(next);
        if (["", "-", ".", "-."].includes(next)) return;
        const parsed = Number(next);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
    {suffix && <span>{suffix}</span>}
  </div>;
}

function Readout({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="readout"><span>{label}</span><b>{value}</b><small>{detail}</small></div>;
}

function Metric({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return <div className={`metric ${accent ? "accent" : ""} ${muted ? "muted" : ""}`}><span>{label}</span><b>{value}</b></div>;
}

function EmptyState() {
  return <div className="empty"><span>＋</span><h3>No saved quotes yet</h3><p>Complete a gross margin calculation and select “Save quote” to keep it here.</p></div>;
}

function AdminSettings({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const update = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch });
  return <div className="admin-stack">
    <section className="panel standalone">
      <div className="section-heading"><div><span>A</span><h2>Model parameters</h2></div><small>Changes affect new calculations for all users</small></div>
      <div className="admin-grid">
        <Field label="Senior approval threshold"><NumberInput value={settings.thresholds.approval * 100} suffix="%" onChange={(v) => update({ thresholds: { ...settings.thresholds, approval: v / 100 } })} /></Field>
        <Field label="Target gross margin"><NumberInput value={settings.thresholds.target * 100} suffix="%" onChange={(v) => update({ thresholds: { ...settings.thresholds, target: v / 100 } })} /></Field>
        <Field label="Solar STC unit price"><NumberInput value={settings.solarStcUnitPrice} prefix="$" onChange={(v) => update({ solarStcUnitPrice: v })} /></Field>
        <Field label="Battery STC unit price"><NumberInput value={settings.batteryStcUnitPrice} prefix="$" onChange={(v) => update({ batteryStcUnitPrice: v })} /></Field>
        <Field label="Battery installation cost"><NumberInput value={settings.batteryInstallCost} prefix="$" onChange={(v) => update({ batteryInstallCost: v })} /></Field>
        <Field label="Delivery cost"><NumberInput value={settings.deliveryCost} prefix="$" onChange={(v) => update({ deliveryCost: v })} /></Field>
        <Field label="Accessories cost / kW"><NumberInput value={settings.accessoryCostPerKw} prefix="$" onChange={(v) => update({ accessoryCostPerKw: v })} /></Field>
        <Field label="Solar installation cost / W"><NumberInput value={settings.solarInstallCostPerWatt} prefix="$" onChange={(v) => update({ solarInstallCostPerWatt: v })} /></Field>
      </div>
    </section>
    <div className="catalog-split">
      <section className="panel standalone">
        <div className="section-heading"><div><span>B</span><h2>Inverter catalogue</h2></div><small>{settings.inverters.length} models</small></div>
        <div className="catalog-table"><div className="catalog-head"><span>Model</span><span>Sydney warehouse cost (excl. GST)</span></div>{settings.inverters.map((item, index) => <div className="catalog-row" key={item.name}><input value={item.name} onChange={(e) => { const next = structuredClone(settings); next.inverters[index].name = e.target.value; onChange(next); }} /><NumberInput compact prefix="$" value={item.cost} onChange={(v) => { const next = structuredClone(settings); next.inverters[index].cost = v; onChange(next); }} /></div>)}</div>
      </section>
      <section className="panel standalone">
        <div className="section-heading"><div><span>C</span><h2>CQ7 battery matrix</h2></div><small>Capacity, cost and STC certificates</small></div>
        <div className="catalog-table battery"><div className="catalog-head"><span>Capacity</span><span>Cost (excl. GST)</span><span>STC certificates</span></div>{settings.batteries.map((item, index) => <div className="catalog-row" key={item.kwh}><NumberInput compact value={item.kwh} suffix="kWh" onChange={(v) => { const next = structuredClone(settings); next.batteries[index].kwh = v; onChange(next); }} /><NumberInput compact prefix="$" value={item.cost} onChange={(v) => { const next = structuredClone(settings); next.batteries[index].cost = v; onChange(next); }} /><NumberInput compact value={item.certificates} onChange={(v) => { const next = structuredClone(settings); next.batteries[index].certificates = v; onChange(next); }} /></div>)}</div>
      </section>
    </div>
  </div>;
}

function UsersPanel({ viewer, users, onChanged }: { viewer: Viewer; users: UserRow[]; onChanged: () => Promise<void> }) {
  const [busyId, setBusyId] = useState("");
  const changeRole = async (userId: string, role: Role) => {
    setBusyId(userId);
    try {
      const response = await fetch("/api/users", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, role }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Unable to update access");
      await onChanged();
    } finally { setBusyId(""); }
  };
  return <section className="panel standalone">
    <div className="section-heading"><div><span>U</span><h2>User access</h2></div><small>The first signed-in user becomes an administrator</small></div>
    <div className="user-list">{users.map((user) => <div key={user.userId} className="user-row"><div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div className="user-info"><b>{user.displayName}{user.userId === viewer.userId && <em>You</em>}</b><small>{user.email}</small></div><select disabled={busyId === user.userId || user.userId === viewer.userId} value={user.role} onChange={(e) => changeRole(user.userId, e.target.value as Role)}><option value="user">Standard user</option><option value="admin">Administrator</option></select></div>)}</div>
    <div className="permission-note"><b>Access rules</b><p>Standard users can edit customer and project details, rebates, discounts and site-specific costs. Only administrators can change equipment catalogues, base costs, STC prices and margin thresholds.</p></div>
  </section>;
}
