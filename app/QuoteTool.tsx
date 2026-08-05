"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateQuote } from "../lib/calculate";
import { defaultQuote } from "../lib/defaults";
import type { AppSettings, QuoteInputs, QuoteRecord, Role, Viewer } from "../lib/model";

type UserRow = { userId: string; email: string; displayName: string; role: Role; createdAt: string };
type SessionData = { viewer: Viewer; settings: AppSettings; quotes: QuoteRecord[]; users: UserRow[] };
type Tab = "quote" | "history" | "settings" | "users";

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const num = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function QuoteTool() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [inputs, setInputs] = useState<QuoteInputs>(defaultQuote);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("quote");
  const [demoRole, setDemoRole] = useState<Role>("admin");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchSession = async () => {
    const response = await fetch("/api/session", { cache: "no-store" });
    const data = await response.json() as SessionData & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "无法加载数据");
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
      .catch((error) => setMessage(error instanceof Error ? error.message : "加载失败"));
  }, []);

  const settings = session?.settings;
  const result = useMemo(() => settings ? calculateQuote(inputs, settings) : null, [inputs, settings]);
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
      if (!response.ok || !data.id) throw new Error(data.error ?? "保存失败");
      setQuoteId(data.id);
      await loadSession();
      flash("报价已保存");
    } catch (error) {
      flash(error instanceof Error ? error.message : "保存失败");
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
      if (!response.ok) throw new Error(data.error ?? "保存失败");
      await loadSession();
      flash("基础数据已发布");
    } catch (error) {
      flash(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  if (!session || !settings || !result || !settingsDraft) {
    return (
      <main className="loading-screen">
        <div className="brand-mark large">QF</div>
        <div><strong>QuoteFlow</strong><p>{message || "正在同步报价模型…"}</p></div>
      </main>
    );
  }

  const statusCopy = {
    healthy: { label: "健康", detail: `已达到 ${pct(settings.thresholds.target)} 目标`, icon: "✓" },
    review: { label: "需复核", detail: "低于目标，仍在可复核区间", icon: "!" },
    approval: { label: "需高级审批", detail: `低于 ${pct(settings.thresholds.approval)} 审批线`, icon: "↑" },
  }[result.status];

  const navItems: Array<{ id: Tab; label: string; glyph: string; admin?: boolean }> = [
    { id: "quote", label: "报价测算", glyph: "⌁" },
    { id: "history", label: "我的报价", glyph: "◷" },
    { id: "settings", label: "基础数据", glyph: "◇", admin: true },
    { id: "users", label: "用户权限", glyph: "◎", admin: true },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">QF</span><span><b>QuoteFlow</b><small>Gross Margin</small></span></div>
        <nav>
          {navItems.filter((item) => !item.admin || isAdmin).map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              <span>{item.glyph}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="model-note">
          <span className="dot" /> <div><b>Excel 模型已同步</b><small>Fox ESS CQ7 · Aug</small></div>
        </div>
        <div className="sidebar-user">
          <div className="avatar">{session.viewer.displayName.slice(0, 1).toUpperCase()}</div>
          <div><b>{session.viewer.displayName}</b><small>{isAdmin ? "管理员" : "普通用户"}</small></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">FOX ESS · CQ7</span>
            <h1>{tab === "quote" ? "新建毛利测算" : tab === "history" ? "我的报价" : tab === "settings" ? "基础数据管理" : "用户与权限"}</h1>
          </div>
          <div className="top-actions">
            {session.viewer.isLocalDemo && (
              <label className="demo-switch">本地演示
                <select value={demoRole} onChange={(event) => { setDemoRole(event.target.value as Role); setTab("quote"); }}>
                  <option value="admin">管理员视图</option><option value="user">普通用户视图</option>
                </select>
              </label>
            )}
            <button className="ghost-btn" onClick={() => { setInputs(defaultQuote); setQuoteId(null); }}>清空</button>
            {tab === "quote" && <button className="primary-btn" disabled={busy} onClick={saveQuote}>{busy ? "保存中…" : "保存报价"}</button>}
            {tab === "settings" && isAdmin && <button className="primary-btn" disabled={busy} onClick={saveSettings}>{busy ? "发布中…" : "发布修改"}</button>}
          </div>
        </header>

        {tab === "quote" && (
          <div className="quote-layout">
            <div className="form-column">
              <section className="panel project-panel">
                <div className="section-heading"><div><span>01</span><h2>项目信息</h2></div><small>橙色字段可由普通用户修改</small></div>
                <div className="field-grid">
                  <Field label="日期"><input type="date" value={inputs.date} onChange={(e) => setField("date", e.target.value)} /></Field>
                  <Field label="客户姓名"><input value={inputs.customerName} placeholder="输入客户姓名" onChange={(e) => setField("customerName", e.target.value)} /></Field>
                  <Field label="项目地址" wide><input value={inputs.address} placeholder="输入安装地址" onChange={(e) => setField("address", e.target.value)} /></Field>
                  <Field label="光伏容量"><NumberInput value={inputs.pvSize} suffix="kW" onChange={(v) => setField("pvSize", v)} /></Field>
                  <Field label="电池容量"><select value={inputs.batteryKwh} onChange={(e) => setField("batteryKwh", num(e.target.value))}>{settings.batteries.map((item) => <option key={item.kwh} value={item.kwh}>{item.kwh} kWh</option>)}</select></Field>
                  <Field label="逆变器" wide><select value={inputs.inverter} onChange={(e) => setField("inverter", e.target.value)}>{settings.inverters.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field>
                  <Field label="E³ Energy Initiator" wide><input value={inputs.initiator} placeholder="负责人姓名" onChange={(e) => setField("initiator", e.target.value)} /></Field>
                </div>
              </section>

              <section className="panel">
                <div className="section-heading"><div><span>02</span><h2>报价明细</h2></div><small>销售价 = 成本 ×（1 + 毛利率）</small></div>
                <div className="table-wrap">
                  <table className="quote-table">
                    <thead><tr><th>项目</th><th>成本（未税）</th><th>毛利率</th><th>销售价（未税）</th></tr></thead>
                    <tbody>
                      {result.lineItems.map((item) => {
                        const manualKey = item.key as keyof QuoteInputs["manualCosts"];
                        return (
                          <tr key={item.key}>
                            <td><b>{item.label}</b>{item.note && <small>{item.note}</small>}</td>
                            <td>{item.editableByUser ? <NumberInput compact value={inputs.manualCosts[manualKey]} prefix="$" onChange={(v) => setManualCost(manualKey, v)} /> : <span className="locked-value">{money.format(item.cost)}</span>}</td>
                            <td><span className="margin-chip">{pct(item.margin)}</span></td>
                            <td><b>{money.format(item.salesPrice)}</b></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="section-heading"><div><span>03</span><h2>补贴与客户余额</h2></div><small>折扣必须输入负数</small></div>
                <div className="funding-grid">
                  <Readout label="Solar STC" value={money.format(result.solarStc)} detail={`${result.solarCertificates} 张 × ${money.format(settings.solarStcUnitPrice)}`} />
                  <Readout label="Battery STC" value={money.format(result.batteryStc)} detail={`${result.batteryCertificates} 张 × ${money.format(settings.batteryStcUnitPrice)}`} />
                  <Field label="Solar VIC Rebate"><NumberInput prefix="$" value={inputs.solarVicRebate} onChange={(v) => setField("solarVicRebate", Math.max(0, v))} /></Field>
                  <Field label="Solar VIC Interest Free Loan"><NumberInput prefix="$" value={inputs.solarVicLoan} onChange={(v) => setField("solarVicLoan", Math.max(0, v))} /></Field>
                  <Field label="折扣"><NumberInput prefix="$" value={inputs.discount} onChange={(v) => setField("discount", Math.min(0, v))} /></Field>
                  <Field label="客户余额（含 GST）"><NumberInput prefix="$" value={inputs.customerBalance} onChange={(v) => setField("customerBalance", v)} /></Field>
                </div>
              </section>
            </div>

            <aside className="summary-column">
              <section className={`status-card ${result.status}`}>
                <div className="status-top"><span className="status-icon">{statusCopy.icon}</span><span>{statusCopy.label}</span></div>
                <div className="margin-number">{pct(result.grossMarginRate)}</div>
                <p>{statusCopy.detail}</p>
                <div className="meter"><i style={{ width: `${Math.min(100, Math.max(0, result.grossMarginRate / settings.thresholds.target * 100))}%` }} /></div>
                <div className="meter-labels"><span>{pct(settings.thresholds.approval)}</span><span>目标 {pct(settings.thresholds.target)}</span></div>
              </section>

              <section className="panel metric-panel">
                <div className="section-heading compact"><div><h2>毛利摘要</h2></div><span className="live-pill"><i /> 实时</span></div>
                <Metric label="总收入（未税）" value={money.format(result.totalReceivedExGst)} />
                <Metric label="总成本（未税）" value={money.format(result.totalCostExGst)} />
                <Metric label="Net GST" value={money.format(result.netGst)} muted />
                <Metric label="Gross Margin" value={money.format(result.grossMargin)} accent />
              </section>

              <section className="target-card">
                <span className="target-kicker">达到 {pct(settings.thresholds.target)} 毛利</span>
                <h3>{money.format(result.targetRequiredBalance)}</h3>
                <p>所需客户余额（含 GST）</p>
                <div className={result.targetGap > 0 ? "gap bad" : "gap good"}>
                  <span>{result.targetGap > 0 ? "仍差" : "已超出"}</span><b>{money.format(Math.abs(result.targetGap))}</b>
                </div>
              </section>

              <div className="formula-note"><b>计算口径</b><p>已按原表复刻 STC、GST、成本和毛利关系。目标余额由公式实时反解，不再依赖 Excel 宏按钮。</p></div>
            </aside>
          </div>
        )}

        {tab === "history" && (
          <section className="panel standalone">
            <div className="section-heading"><div><span>◷</span><h2>最近报价</h2></div><small>仅显示你自己的记录</small></div>
            {session.quotes.length === 0 ? <EmptyState /> : (
              <div className="history-list">{session.quotes.map((quote) => {
                const calculated = calculateQuote(quote.payload, settings);
                return <button key={quote.id} onClick={() => { setQuoteId(quote.id); setInputs(quote.payload); setTab("quote"); }}>
                  <span><b>{quote.projectName}</b><small>{quote.payload.address || "未填写地址"}</small></span>
                  <span><b>{money.format(calculated.grossMargin)}</b><small className={`mini-status ${calculated.status}`}>{pct(calculated.grossMarginRate)}</small></span>
                  <span className="chevron">›</span>
                </button>;
              })}</div>
            )}
          </section>
        )}

        {tab === "settings" && isAdmin && (
          <AdminSettings settings={settingsDraft} onChange={setSettingsDraft} />
        )}

        {tab === "users" && isAdmin && (
          <UsersPanel viewer={session.viewer} users={session.users} onChanged={async () => { await loadSession(); flash("权限已更新"); }} />
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
  return <div className={`number-input ${compact ? "compact" : ""}`}>{prefix && <span>{prefix}</span>}<input type="number" step="any" value={value} onChange={(e) => onChange(num(e.target.value))} />{suffix && <span>{suffix}</span>}</div>;
}

function Readout({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="readout"><span>{label}</span><b>{value}</b><small>{detail}</small></div>;
}

function Metric({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return <div className={`metric ${accent ? "accent" : ""} ${muted ? "muted" : ""}`}><span>{label}</span><b>{value}</b></div>;
}

function EmptyState() {
  return <div className="empty"><span>＋</span><h3>还没有保存的报价</h3><p>完成一次毛利测算并点击“保存报价”，记录会出现在这里。</p></div>;
}

function AdminSettings({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const update = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch });
  return <div className="admin-stack">
    <section className="panel standalone">
      <div className="section-heading"><div><span>A</span><h2>模型参数</h2></div><small>修改后会影响所有用户的新计算</small></div>
      <div className="admin-grid">
        <Field label="高级审批线"><NumberInput value={settings.thresholds.approval * 100} suffix="%" onChange={(v) => update({ thresholds: { ...settings.thresholds, approval: v / 100 } })} /></Field>
        <Field label="目标毛利率"><NumberInput value={settings.thresholds.target * 100} suffix="%" onChange={(v) => update({ thresholds: { ...settings.thresholds, target: v / 100 } })} /></Field>
        <Field label="Solar STC 单价"><NumberInput value={settings.solarStcUnitPrice} prefix="$" onChange={(v) => update({ solarStcUnitPrice: v })} /></Field>
        <Field label="Battery STC 单价"><NumberInput value={settings.batteryStcUnitPrice} prefix="$" onChange={(v) => update({ batteryStcUnitPrice: v })} /></Field>
        <Field label="电池安装成本"><NumberInput value={settings.batteryInstallCost} prefix="$" onChange={(v) => update({ batteryInstallCost: v })} /></Field>
        <Field label="运费"><NumberInput value={settings.deliveryCost} prefix="$" onChange={(v) => update({ deliveryCost: v })} /></Field>
        <Field label="配件成本 / kW"><NumberInput value={settings.accessoryCostPerKw} prefix="$" onChange={(v) => update({ accessoryCostPerKw: v })} /></Field>
        <Field label="光伏安装成本 / W"><NumberInput value={settings.solarInstallCostPerWatt} prefix="$" onChange={(v) => update({ solarInstallCostPerWatt: v })} /></Field>
      </div>
    </section>
    <section className="panel standalone">
      <div className="section-heading"><div><span>B</span><h2>逆变器目录</h2></div><small>{settings.inverters.length} 个型号</small></div>
      <div className="catalog-table"><div className="catalog-head"><span>型号</span><span>悉尼仓成本（未税）</span></div>{settings.inverters.map((item, index) => <div className="catalog-row" key={item.name}><input value={item.name} onChange={(e) => { const next = structuredClone(settings); next.inverters[index].name = e.target.value; onChange(next); }} /><NumberInput compact prefix="$" value={item.cost} onChange={(v) => { const next = structuredClone(settings); next.inverters[index].cost = v; onChange(next); }} /></div>)}</div>
    </section>
    <section className="panel standalone">
      <div className="section-heading"><div><span>C</span><h2>CQ7 电池矩阵</h2></div><small>容量、成本与 STC 张数</small></div>
      <div className="catalog-table battery"><div className="catalog-head"><span>容量</span><span>成本（未税）</span><span>STC 张数</span></div>{settings.batteries.map((item, index) => <div className="catalog-row" key={item.kwh}><NumberInput compact value={item.kwh} suffix="kWh" onChange={(v) => { const next = structuredClone(settings); next.batteries[index].kwh = v; onChange(next); }} /><NumberInput compact prefix="$" value={item.cost} onChange={(v) => { const next = structuredClone(settings); next.batteries[index].cost = v; onChange(next); }} /><NumberInput compact value={item.certificates} onChange={(v) => { const next = structuredClone(settings); next.batteries[index].certificates = v; onChange(next); }} /></div>)}</div>
    </section>
  </div>;
}

function UsersPanel({ viewer, users, onChanged }: { viewer: Viewer; users: UserRow[]; onChanged: () => Promise<void> }) {
  const [busyId, setBusyId] = useState("");
  const changeRole = async (userId: string, role: Role) => {
    setBusyId(userId);
    try {
      const response = await fetch("/api/users", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, role }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "更新失败");
      await onChanged();
    } finally { setBusyId(""); }
  };
  return <section className="panel standalone">
    <div className="section-heading"><div><span>U</span><h2>用户权限</h2></div><small>首位登录用户自动成为管理员</small></div>
    <div className="user-list">{users.map((user) => <div key={user.userId} className="user-row"><div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div className="user-info"><b>{user.displayName}{user.userId === viewer.userId && <em>你</em>}</b><small>{user.email}</small></div><select disabled={busyId === user.userId || user.userId === viewer.userId} value={user.role} onChange={(e) => changeRole(user.userId, e.target.value as Role)}><option value="user">普通用户</option><option value="admin">管理员</option></select></div>)}</div>
    <div className="permission-note"><b>权限规则</b><p>普通用户可编辑客户、项目、补贴、折扣和现场附加成本；设备目录、基础成本、STC 单价与毛利阈值仅管理员可改。</p></div>
  </section>;
}
