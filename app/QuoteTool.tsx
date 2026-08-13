"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { calculateQuote } from "../lib/calculate";
import { defaultQuote } from "../lib/defaults";
import type { AppSettings, CatalogItem, CiBatterySelection, CiInverterSelection, CiPvSystem, EquipmentSelection, QuoteInputs, QuoteRecord, QuoteStatus, Role, SystemNotification, Viewer } from "../lib/model";
import { getEquipmentCatalogs, normalizeQuoteConfiguration, setEquipmentBrand as applyEquipmentBrand, setQuoteMode, syncCiLegacyFields, updatePvSize } from "../lib/quote-inputs";

type UserRow = { userId: string; email: string; displayName: string; role: Role; createdAt: string };
type SessionData = { viewer: Viewer; settings: AppSettings; quotes: QuoteRecord[]; users: UserRow[]; notifications: SystemNotification[] };
type Tab = "quote" | "history" | "settings" | "users";

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const num = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;
const inputNumber = (value: number) => value === 0 ? "" : String(Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000);
const percentageRate = (value: number) => Math.round((value / 100) * 1_000_000) / 1_000_000;
const batteryModelLabel = (name: string) => name.replace(/^\s*\d+\s*[×x]\s*/i, "");
const sigBatteryStcReference: Array<{ batteryKwh: number; stc: number } | null> = [
  { batteryKwh: 16, stc: 101 },
  { batteryKwh: 24, stc: 133 },
  { batteryKwh: 32, stc: 155 },
  { batteryKwh: 40, stc: 163 },
  { batteryKwh: 48, stc: 171 },
  null,
  { batteryKwh: 20, stc: 119 },
  { batteryKwh: 30, stc: 154 },
  { batteryKwh: 40, stc: 164 },
  { batteryKwh: 50, stc: 174 },
];
const quoteCreatedDateKey = (value: string) => value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
const quoteCreatedDateLabel = (value: string) => {
  const key = quoteCreatedDateKey(value);
  if (!key) return "Unknown date";
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(year, month - 1, day));
};
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
const safeExportName = (value: string) => value
  .trim()
  .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
  .replace(/\s+/g, "-")
  .replace(/-+/g, "-")
  .slice(0, 80) || "quote";
const freshQuote = (): QuoteInputs => ({
  ...defaultQuote,
  date: today(),
  customItems: [...(defaultQuote.customItems ?? [])],
  manualCosts: { ...defaultQuote.manualCosts },
  manualMargins: { ...(defaultQuote.manualMargins ?? {}) },
});

export function QuoteTool() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [inputs, setInputs] = useState<QuoteInputs>(() => freshQuote());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("quote");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quoteInitiatorFilter, setQuoteInitiatorFilter] = useState("");
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<QuoteStatus | "">("");
  const [quoteCreatedFrom, setQuoteCreatedFrom] = useState("");
  const [quoteCreatedTo, setQuoteCreatedTo] = useState("");
  const [statusBusyId, setStatusBusyId] = useState("");
  const [quoteTransferBusy, setQuoteTransferBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginRequired, setLoginRequired] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const quoteImportRef = useRef<HTMLInputElement>(null);

  const fetchSession = async () => {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (response.status === 401) return null;
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Unable to load the quote tool. Please refresh and sign in again.");
    }
    const data = await response.json() as SessionData & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Unable to load data");
    return data as SessionData;
  };

  const loadSession = async () => {
    const data = await fetchSession();
    if (!data) {
      setSession(null);
      setLoginRequired(true);
      return;
    }
    setSession(data);
    setSettingsDraft(structuredClone(data.settings));
    setLoginRequired(false);
  };

  useEffect(() => {
    void fetchSession()
      .then((data) => {
        if (!data) {
          setLoginRequired(true);
          return;
        }
        setSession(data);
        setSettingsDraft(structuredClone(data.settings));
        setLoginRequired(false);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load data"));
  }, []);

  const settings = session?.settings;
  const result = useMemo(() => settings ? calculateQuote(inputs, settings) : null, [inputs, settings]);
  const initiatorOptions = useMemo(() => Array.from(new Set((session?.quotes ?? [])
    .map((quote) => quote.payload.initiator?.trim())
    .filter((value): value is string => Boolean(value))))
    .sort((left, right) => left.localeCompare(right, "en-AU", { sensitivity: "base" })), [session?.quotes]);
  const filteredQuotes = useMemo(() => {
    const query = quoteSearch.trim().toLowerCase();
    return (session?.quotes ?? []).filter((quote) => {
      const matchesSearch = !query || [
        quote.projectName,
        quote.payload.customerName,
        quote.payload.address,
        quote.payload.phone,
        quote.payload.initiator,
        quote.ownerName,
        quote.payload.ciInverters?.map((item) => item.model).join(" "),
        quote.payload.ciBatteries?.map((item) => item.kwh).join(" "),
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
      const initiator = quote.payload.initiator?.trim() ?? "";
      const matchesInitiator = !quoteInitiatorFilter
        || quoteInitiatorFilter === "__none__" && !initiator
        || initiator === quoteInitiatorFilter;
      const createdDate = quoteCreatedDateKey(quote.createdAt);
      const matchesCreatedFrom = !quoteCreatedFrom || Boolean(createdDate && createdDate >= quoteCreatedFrom);
      const matchesCreatedTo = !quoteCreatedTo || Boolean(createdDate && createdDate <= quoteCreatedTo);
      const matchesStatus = !quoteStatusFilter || quote.status === quoteStatusFilter;
      return matchesSearch && matchesInitiator && matchesCreatedFrom && matchesCreatedTo && matchesStatus;
    });
  }, [quoteCreatedFrom, quoteCreatedTo, quoteInitiatorFilter, quoteSearch, quoteStatusFilter, session?.quotes]);
  const hasHistoryFilters = Boolean(quoteSearch || quoteInitiatorFilter || quoteStatusFilter || quoteCreatedFrom || quoteCreatedTo);
  const clearHistoryFilters = () => {
    setQuoteSearch("");
    setQuoteInitiatorFilter("");
    setQuoteStatusFilter("");
    setQuoteCreatedFrom("");
    setQuoteCreatedTo("");
  };
  const role = session?.viewer.role ?? "user";
  const isAdmin = role === "admin";

  const setField = <K extends keyof QuoteInputs>(key: K, value: QuoteInputs[K]) => {
    setInputs((current) => ({ ...current, [key]: value }));
  };
  const setManualCost = (key: keyof QuoteInputs["manualCosts"], value: number) => {
    setInputs((current) => ({ ...current, manualCosts: { ...current.manualCosts, [key]: value } }));
  };
  const setManualMargin = (key: string, value: number) => {
    setInputs((current) => ({ ...current, manualMargins: { ...(current.manualMargins ?? {}), [key]: value } }));
  };
  const setPvSize = (value: number) => {
    setInputs((current) => updatePvSize(current, value));
  };
  const quantity = (value: number) => Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
  const updateCiPvSystem = (id: string, patch: Partial<CiPvSystem>) => {
    setInputs((current) => {
      const manualCosts = { ...current.manualCosts };
      delete manualCosts.accessories;
      delete manualCosts.solarInstallation;
      return syncCiLegacyFields({
        ...current,
        manualCosts,
        ciPvSystems: (current.ciPvSystems ?? []).map((item) => item.id === id
          ? { ...item, ...patch, sizeKw: Math.max(0, patch.sizeKw ?? item.sizeKw), quantity: quantity(patch.quantity ?? item.quantity) }
          : item),
      });
    });
  };
  const updateCiInverter = (id: string, patch: Partial<CiInverterSelection>) => {
    setInputs((current) => syncCiLegacyFields({
      ...current,
      ciInverters: (current.ciInverters ?? []).map((item) => item.id === id
        ? { ...item, ...patch, quantity: quantity(patch.quantity ?? item.quantity) }
        : item),
    }));
  };
  const updateCiBattery = (id: string, patch: Partial<CiBatterySelection>) => {
    setInputs((current) => {
      const manualCosts = { ...current.manualCosts };
      delete manualCosts.batteryInstallation;
      return syncCiLegacyFields({
        ...current,
        manualCosts,
        ciBatteries: (current.ciBatteries ?? []).map((item) => item.id === id
          ? { ...item, ...patch, kwh: Math.max(0, patch.kwh ?? item.kwh), quantity: quantity(patch.quantity ?? item.quantity) }
          : item),
      });
    });
  };
  const addCiPvSystem = () => setInputs((current) => {
    const manualCosts = { ...current.manualCosts };
    delete manualCosts.accessories;
    delete manualCosts.solarInstallation;
    return syncCiLegacyFields({
      ...current,
      manualCosts,
      ciPvSystems: [...(current.ciPvSystems ?? []), { id: crypto.randomUUID(), sizeKw: 0, quantity: 1 }],
    });
  });
  const addCiInverter = () => setInputs((current) => {
    const catalog = settings ? getEquipmentCatalogs(settings, "fox", "ci") : { inverters: [], batteries: [] };
    return syncCiLegacyFields({
      ...current,
      ciInverters: [...(current.ciInverters ?? []), { id: crypto.randomUUID(), model: catalog.inverters[0]?.name ?? "", quantity: 1 }],
    });
  });
  const addCiBattery = () => setInputs((current) => {
    const manualCosts = { ...current.manualCosts };
    delete manualCosts.batteryInstallation;
    const catalog = settings ? getEquipmentCatalogs(settings, "fox", "ci") : { inverters: [], batteries: [] };
    return syncCiLegacyFields({
      ...current,
      manualCosts,
      ciBatteries: [...(current.ciBatteries ?? []), { id: crypto.randomUUID(), kwh: catalog.batteries[0]?.kwh ?? 0, quantity: 1 }],
    });
  });
  const removeCiSelection = (key: "ciPvSystems" | "ciInverters" | "ciBatteries", id: string) => {
    setInputs((current) => {
      const items = current[key] ?? [];
      if (items.length <= 1) return current;
      const manualCosts = { ...current.manualCosts };
      if (key === "ciPvSystems") {
        delete manualCosts.accessories;
        delete manualCosts.solarInstallation;
      }
      if (key === "ciBatteries") delete manualCosts.batteryInstallation;
      return syncCiLegacyFields({ ...current, manualCosts, [key]: items.filter((item) => item.id !== id) });
    });
  };
  const sigCatalogFor = (key: "sigInverters" | "sigBatteries" | "sigGateways" | "sigAccessories", current: QuoteInputs) => {
    if (!settings) return [];
    const catalogs = getEquipmentCatalogs(settings, "sig", current.mode === "ci" ? "ci" : "residential");
    return key === "sigInverters" ? catalogs.inverters
      : key === "sigBatteries" ? catalogs.batteries
        : key === "sigGateways" ? catalogs.gateways
          : catalogs.accessories;
  };
  const updateSigSelection = (key: "sigInverters" | "sigBatteries" | "sigGateways" | "sigAccessories", id: string, patch: Partial<EquipmentSelection>) => {
    setInputs((current) => {
      const manualCosts = { ...current.manualCosts };
      if (key === "sigBatteries") delete manualCosts.batteryInstallation;
      return syncCiLegacyFields({
        ...current,
        manualCosts,
        [key]: (current[key] ?? []).map((item) => item.id === id
        ? { ...item, ...patch, quantity: quantity(patch.quantity ?? item.quantity) }
        : item),
      }, settings);
    });
  };
  const addSigSelection = (key: "sigInverters" | "sigBatteries" | "sigGateways" | "sigAccessories") => {
    setInputs((current) => {
      const catalog = sigCatalogFor(key, current);
      if (!catalog.length) return current;
      const manualCosts = { ...current.manualCosts };
      if (key === "sigBatteries") delete manualCosts.batteryInstallation;
      return syncCiLegacyFields({
        ...current,
        manualCosts,
        [key]: [...(current[key] ?? []), { id: crypto.randomUUID(), model: catalog[0].name, quantity: 1 }],
      }, settings);
    });
  };
  const removeSigSelection = (key: "sigInverters" | "sigBatteries" | "sigGateways" | "sigAccessories", id: string) => {
    setInputs((current) => {
      const items = current[key] ?? [];
      const required = key === "sigInverters" || key === "sigBatteries";
      if (required && items.length <= 1) return current;
      const manualCosts = { ...current.manualCosts };
      if (key === "sigBatteries") delete manualCosts.batteryInstallation;
      return syncCiLegacyFields({ ...current, manualCosts, [key]: items.filter((item) => item.id !== id) }, settings);
    });
  };
  const addCustomItem = () => {
    setInputs((current) => ({
      ...current,
      customItems: [...(current.customItems ?? []), { id: crypto.randomUUID(), name: "Custom item", cost: 0, margin: 0.25 }],
    }));
  };
  const updateCustomItem = (id: string, patch: Partial<NonNullable<QuoteInputs["customItems"]>[number]>) => {
    setInputs((current) => ({
      ...current,
      customItems: (current.customItems ?? []).map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  };
  const removeCustomItem = (id: string) => {
    setInputs((current) => ({ ...current, customItems: (current.customItems ?? []).filter((item) => item.id !== id) }));
  };
  const applyMarginBalance = (value: number) => setField("customerBalance", Math.round(value * 100) / 100);

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2800);
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to sign in");
      await loadSession();
      setLoginPassword("");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to sign in");
    } finally {
      setLoginBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      setSession(null);
      setSettingsDraft(null);
      setLoginPassword("");
      setLoginRequired(true);
      setTab("quote");
      setBusy(false);
    }
  };

  const saveQuote = async () => {
    if (!inputs.customerName.trim()) {
      flash("Need a Customer Name");
      document.getElementById("customer-name")?.focus();
      return;
    }
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

  const changeQuoteStatus = async (id: string, status: QuoteStatus) => {
    setStatusBusyId(id);
    try {
      const response = await fetch("/api/quotes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to update status");
      setSession((current) => current ? {
        ...current,
        quotes: current.quotes.map((quote) => quote.id === id ? { ...quote, status } : quote),
      } : current);
      flash(status === "done" ? "Quote marked as done" : "Quote moved to drafting");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to update status");
    } finally {
      setStatusBusyId("");
    }
  };

  const removeQuote = async (id: string, projectName: string) => {
    if (!isAdmin || !window.confirm(`Delete “${projectName}”? This cannot be undone.`)) return;
    setStatusBusyId(id);
    try {
      const response = await fetch("/api/quotes/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to delete quote");
      setSession((current) => current ? {
        ...current,
        quotes: current.quotes.filter((quote) => quote.id !== id),
      } : current);
      if (quoteId === id) {
        setQuoteId(null);
        setInputs(freshQuote());
      }
      flash("Quote deleted");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to delete quote");
    } finally {
      setStatusBusyId("");
    }
  };

  const downloadQuotesExcel = async (quotes: QuoteRecord[], filename: string, successMessage: string) => {
    if (!quotes.length) return;
    setQuoteTransferBusy(true);
    try {
      const { createQuotesWorkbook } = await import("../lib/quote-excel");
      const bytes = createQuotesWorkbook(quotes, settings);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      flash(successMessage);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to export Excel file");
    } finally {
      setQuoteTransferBusy(false);
    }
  };

  const exportQuotes = async () => {
    if (!session?.quotes.length) return;
    await downloadQuotesExcel(session.quotes, `e3-quotes-${today()}.xlsx`, `${session.quotes.length} quotes exported to Excel`);
  };

  const exportSingleQuote = async (quote: QuoteRecord) => {
    const projectName = quote.projectName || quote.payload.customerName || "quote";
    await downloadQuotesExcel([quote], `e3-${safeExportName(projectName)}-${today()}.xlsx`, `${projectName} exported to Excel`);
  };

  const importQuotesFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setQuoteTransferBusy(true);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("Import file must be smaller than 20 MB");
      const { parseQuotesWorkbook } = await import("../lib/quote-excel");
      const payloads = parseQuotesWorkbook(await file.arrayBuffer());
      const response = await fetch("/api/quotes/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloads),
      });
      const data = await response.json() as { imported?: number; error?: string };
      if (!response.ok || !data.imported) throw new Error(data.error ?? "Unable to import quotes");
      await loadSession();
      flash(`${data.imported} quotes imported as Done`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to import Excel file");
    } finally {
      event.target.value = "";
      setQuoteTransferBusy(false);
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

  if (loginRequired) {
    return (
      <LoginScreen
        username={loginUsername}
        password={loginPassword}
        busy={loginBusy}
        error={loginError}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onSubmit={signIn}
      />
    );
  }

  if (!session || !settings || !result || !settingsDraft) {
    return (
      <main className="loading-screen">
        <span className="brand-logo-badge large" role="img" aria-label="E3 Energy" />
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
    { id: "history", label: "Team quotes", glyph: "◷" },
    { id: "settings", label: "Base data", glyph: "◇", admin: true },
    { id: "users", label: "User access", glyph: "◎", admin: true },
  ];
  const notifications = session.notifications ?? [];
  const isCiMode = inputs.mode === "ci";
  const equipmentBrand = inputs.equipmentBrand === "sig" ? "sig" : "fox";
  const stcIsEditable = isCiMode || equipmentBrand === "sig";
  const equipmentCatalogs = getEquipmentCatalogs(settings, equipmentBrand, isCiMode ? "ci" : "residential");
  const brandHasInverters = equipmentCatalogs.inverters.length > 0;
  const brandHasBatteries = equipmentCatalogs.batteries.length > 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-logo-badge" role="img" aria-label="E3 Energy" /><span><b>E3 Quoter</b></span></div>
        <nav>
          {navItems.filter((item) => !item.admin || isAdmin).map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              <span>{item.glyph}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="notification-feed" aria-label="Administrator updates">
          {notifications.length > 0 ? notifications.map((notification) => (
            <div className="model-note notification-card has-update" key={notification.id}>
              <span className="dot" />
              <div>
                <b className="notification-message">{notification.message}</b>
                <small>{notification.createdBy} · {notificationTime(notification.createdAt)}</small>
              </div>
            </div>
          )) : (
            <div className="model-note notification-card">
              <span className="dot" />
              <div><b>No new updates</b><small>Admin changes will appear here</small></div>
            </div>
          )}
        </div>
        <div className="sidebar-user">
          <div className="avatar">{session.viewer.displayName.slice(0, 1).toUpperCase()}</div>
          <div><b>{session.viewer.displayName}</b><small>{isAdmin ? "Administrator" : "Standard user"}</small></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{tab === "quote" ? "Quote Table" : tab === "history" ? "Team quotes" : tab === "settings" ? "Base data management" : "Users & access"}</h1>
          </div>
          <div className="top-actions">
            {tab === "quote" && <div className="mode-switch" role="group" aria-label="Quote mode">
              <button type="button" className={!isCiMode ? "active" : ""} aria-pressed={!isCiMode} onClick={() => setInputs((current) => setQuoteMode(current, "residential", settings))}>Residential</button>
              <button type="button" className={isCiMode ? "active" : ""} aria-pressed={isCiMode} onClick={() => setInputs((current) => setQuoteMode(current, "ci", settings))}>C&amp;I</button>
            </div>}
            <button className="ghost-btn mobile-hide" onClick={() => { setInputs(freshQuote()); setQuoteId(null); }}>Reset</button>
            <button className="ghost-btn" disabled={busy} onClick={() => void signOut()}>Sign out</button>
            {tab === "quote" && <button className="primary-btn" disabled={busy} onClick={saveQuote}>{busy ? "Saving…" : "Save quote"}</button>}
            {tab === "settings" && isAdmin && <button className="primary-btn" disabled={busy} onClick={saveSettings}>{busy ? "Publishing…" : "Publish changes"}</button>}
          </div>
        </header>

        {tab === "quote" && (
          <div className="quote-layout">
            <div className="form-column">
              <section className={`panel project-panel ${isCiMode ? "ci-project-panel" : ""} ${equipmentBrand === "sig" ? "sig-project-panel" : ""}`}>
                <div className="section-heading"><div><span>01</span><h2>Project information</h2></div><small>Standard users can edit orange fields</small></div>
                <div className="project-columns">
                  <div className="project-column customer-details">
                    <div className="column-label">Customer details</div>
                    <Field label="Date"><input type="date" value={inputs.date} onChange={(e) => setField("date", e.target.value)} /></Field>
                    <Field label="Customer name"><input id="customer-name" required value={inputs.customerName} placeholder="Enter customer name" onChange={(e) => setField("customerName", e.target.value)} /></Field>
                    <Field label="Phone"><input type="tel" value={inputs.phone ?? ""} placeholder="Enter phone number" onChange={(e) => setField("phone", e.target.value)} /></Field>
                    <Field label="Project address"><input value={inputs.address} placeholder="Enter installation address" onChange={(event) => setField("address", event.target.value)} /></Field>
                    <Field label="E³ Energy Initiator"><input value={inputs.initiator} placeholder="Enter owner name" onChange={(e) => setField("initiator", e.target.value)} /></Field>
                  </div>
                  <div className="project-column system-details">
                    <div className="column-label">System configuration</div>
                    <div className="equipment-brand-field">
                      <span>Equipment brand</span>
                      <div className="equipment-brand-switch" role="group" aria-label="Equipment brand">
                        <button type="button" className={equipmentBrand === "fox" ? "active" : ""} aria-pressed={equipmentBrand === "fox"} onClick={() => setInputs((current) => applyEquipmentBrand(current, "fox", settings))}>FOX</button>
                        <button type="button" className={equipmentBrand === "sig" ? "active" : ""} aria-pressed={equipmentBrand === "sig"} onClick={() => setInputs((current) => applyEquipmentBrand(current, "sig", settings))}>SIG</button>
                      </div>
                    </div>
                    {equipmentBrand === "sig" ? <div className="ci-config-stack sig-config-stack">
                      {!isCiMode ? <Field label="PV system size"><NumberInput value={inputs.pvSize} suffix="kW" onChange={setPvSize} /></Field> : <CiConfigGroup label="PV systems" total={`${result.totalPvSize} kW`} addLabel="Add PV system" onAdd={addCiPvSystem}>
                        {(inputs.ciPvSystems ?? []).map((item) => <div className="ci-config-row pv" key={item.id}>
                          <Field label="System size"><NumberInput value={item.sizeKw} suffix="kW" onChange={(value) => updateCiPvSystem(item.id, { sizeKw: value })} /></Field>
                          <Field label="Quantity"><NumberInput value={item.quantity} onChange={(value) => updateCiPvSystem(item.id, { quantity: value })} /></Field>
                          <RemoveCiButton label="PV system" disabled={(inputs.ciPvSystems?.length ?? 0) <= 1} onClick={() => removeCiSelection("ciPvSystems", item.id)} />
                        </div>)}
                      </CiConfigGroup>}
                      <SigEquipmentGroup label="Inverters" addLabel="Add inverter" total={`${(inputs.sigInverters ?? []).reduce((sum, item) => sum + item.quantity, 0)} units`} items={inputs.sigInverters ?? []} options={equipmentCatalogs.inverters} required onAdd={() => addSigSelection("sigInverters")} onUpdate={(id, patch) => updateSigSelection("sigInverters", id, patch)} onRemove={(id) => removeSigSelection("sigInverters", id)} />
                      <SigEquipmentGroup label="Batteries & controllers" addLabel="Add battery" total={`${(inputs.sigBatteries ?? []).reduce((sum, item) => sum + item.quantity, 0)} items · ${result.totalBatteryKwh} kWh`} items={inputs.sigBatteries ?? []} options={equipmentCatalogs.batteries} required onAdd={() => addSigSelection("sigBatteries")} onUpdate={(id, patch) => updateSigSelection("sigBatteries", id, patch)} onRemove={(id) => removeSigSelection("sigBatteries", id)} />
                      <SigEquipmentGroup label="Gateways" addLabel="Add gateway" total={`${(inputs.sigGateways ?? []).reduce((sum, item) => sum + item.quantity, 0)} units`} items={inputs.sigGateways ?? []} options={equipmentCatalogs.gateways} onAdd={() => addSigSelection("sigGateways")} onUpdate={(id, patch) => updateSigSelection("sigGateways", id, patch)} onRemove={(id) => removeSigSelection("sigGateways", id)} />
                      <SigEquipmentGroup label="SIG accessories" addLabel="Add accessory" total={`${(inputs.sigAccessories ?? []).reduce((sum, item) => sum + item.quantity, 0)} items`} items={inputs.sigAccessories ?? []} options={equipmentCatalogs.accessories} onAdd={() => addSigSelection("sigAccessories")} onUpdate={(id, patch) => updateSigSelection("sigAccessories", id, patch)} onRemove={(id) => removeSigSelection("sigAccessories", id)} />
                    </div> : !isCiMode ? <>
                      <Field label="PV system size"><NumberInput value={inputs.pvSize} suffix="kW" onChange={setPvSize} /></Field>
                      <Field label="Inverter"><select value={inputs.inverter} disabled={!brandHasInverters} onChange={(e) => setField("inverter", e.target.value)}>{!brandHasInverters && <option value="">No {equipmentBrand.toUpperCase()} inverter data yet</option>}{equipmentCatalogs.inverters.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field>
                      <Field label="Battery size"><select value={inputs.batteryKwh} disabled={!brandHasBatteries} onChange={(e) => setField("batteryKwh", num(e.target.value))}>{!brandHasBatteries && <option value={0}>No {equipmentBrand.toUpperCase()} battery data yet</option>}{equipmentCatalogs.batteries.map((item) => <option key={item.kwh} value={item.kwh}>{item.kwh} kWh</option>)}</select></Field>
                    </> : <div className="ci-config-stack">
                      <CiConfigGroup label="PV systems" total={`${result.totalPvSize} kW`} addLabel="Add PV system" onAdd={addCiPvSystem}>
                        {(inputs.ciPvSystems ?? []).map((item) => <div className="ci-config-row pv" key={item.id}>
                          <Field label="System size"><NumberInput value={item.sizeKw} suffix="kW" onChange={(value) => updateCiPvSystem(item.id, { sizeKw: value })} /></Field>
                          <Field label="Quantity"><NumberInput value={item.quantity} onChange={(value) => updateCiPvSystem(item.id, { quantity: value })} /></Field>
                          <RemoveCiButton label="PV system" disabled={(inputs.ciPvSystems?.length ?? 0) <= 1} onClick={() => removeCiSelection("ciPvSystems", item.id)} />
                        </div>)}
                      </CiConfigGroup>
                      <CiConfigGroup label="Inverters" total={`${(inputs.ciInverters ?? []).reduce((sum, item) => sum + item.quantity, 0)} units`} addLabel="Add inverter" disabled={!brandHasInverters} onAdd={addCiInverter}>
                        {(inputs.ciInverters ?? []).map((item) => <div className="ci-config-row" key={item.id}>
                          <Field label="Model"><select value={item.model} disabled={!brandHasInverters} onChange={(event) => updateCiInverter(item.id, { model: event.target.value })}>{!brandHasInverters && <option value="">No {equipmentBrand.toUpperCase()} inverter data yet</option>}{equipmentCatalogs.inverters.map((option) => <option key={option.name}>{option.name}</option>)}</select></Field>
                          <Field label="Quantity"><NumberInput value={item.quantity} onChange={(value) => updateCiInverter(item.id, { quantity: value })} /></Field>
                          <RemoveCiButton label="inverter" disabled={(inputs.ciInverters?.length ?? 0) <= 1} onClick={() => removeCiSelection("ciInverters", item.id)} />
                        </div>)}
                      </CiConfigGroup>
                      <CiConfigGroup label="Batteries" total={`${result.totalBatteryKwh} kWh`} addLabel="Add battery" disabled={!brandHasBatteries} onAdd={addCiBattery}>
                        {(inputs.ciBatteries ?? []).map((item) => <div className="ci-config-row" key={item.id}>
                          <Field label="Model"><select value={item.kwh} disabled={!brandHasBatteries} onChange={(event) => updateCiBattery(item.id, { kwh: num(event.target.value) })}>{!brandHasBatteries && <option value={0}>No {equipmentBrand.toUpperCase()} battery data yet</option>}{equipmentCatalogs.batteries.map((option) => <option key={option.kwh} value={option.kwh}>{batteryModelLabel(option.name)}</option>)}</select></Field>
                          <Field label="Quantity"><NumberInput value={item.quantity} onChange={(value) => updateCiBattery(item.id, { quantity: value })} /></Field>
                          <RemoveCiButton label="battery" disabled={(inputs.ciBatteries?.length ?? 0) <= 1} onClick={() => removeCiSelection("ciBatteries", item.id)} />
                        </div>)}
                      </CiConfigGroup>
                    </div>}
                  </div>
                </div>
              </section>

              <section className="panel">
                <div className="section-heading"><div><span>02</span><h2>Quote breakdown</h2></div><small>Sales price = cost × (1 + margin)</small></div>
                <div className="quote-funding-layout">
                  <div className="quote-lines">
                    <div className="embedded-heading"><b>Quote items</b><div className="quote-items-actions"><small>Cost, margin and sales price</small><button type="button" className="add-item-btn" onClick={addCustomItem}>＋ Add item</button></div></div>
                    <div className="table-wrap">
                      <table className="quote-table">
                        <colgroup>
                          <col className="quote-item-column" />
                          <col className="quote-cost-column" />
                          <col className="quote-margin-column" />
                          <col className="quote-sales-column" />
                        </colgroup>
                        <thead><tr><th>Item</th><th>Cost (excl. GST)</th><th>Margin</th><th>Sales price (excl. GST)</th></tr></thead>
                        <tbody>
                          {result.lineItems.map((item) => {
                            const manualKey = item.key as keyof QuoteInputs["manualCosts"];
                            const isCustom = Boolean(item.customItemId);
                            return (
                              <tr key={item.key}>
                                <td>{isCustom ? <input className="custom-item-name" value={item.customItemName ?? ""} placeholder="Item name" aria-label="Custom item name" onChange={(event) => updateCustomItem(item.customItemId!, { name: event.target.value })} /> : <><b>{item.label}</b>{item.note && <small>{item.note}</small>}</>}</td>
                                <td>{isCustom ? <NumberInput compact value={item.cost} prefix="$" onChange={(v) => updateCustomItem(item.customItemId!, { cost: Math.max(0, v) })} /> : item.editableByUser ? <NumberInput compact value={item.cost} prefix="$" onChange={(v) => setManualCost(manualKey, v)} /> : <span className="locked-value">{money.format(item.cost)}</span>}</td>
                                <td>{isCustom ? <NumberInput compact value={item.margin * 100} suffix="%" onChange={(v) => updateCustomItem(item.customItemId!, { margin: percentageRate(Math.max(0, v)) })} /> : isCiMode ? <NumberInput compact value={item.margin * 100} suffix="%" onChange={(v) => setManualMargin(item.key, percentageRate(Math.max(0, v)))} /> : <span className="margin-chip">{pct(item.margin)}</span>}</td>
                                <td><div className="sales-cell"><b>{money.format(item.salesPrice)}</b>{isCustom && <button type="button" className="remove-item-btn" aria-label={`Remove ${item.label}`} onClick={() => removeCustomItem(item.customItemId!)}>×</button>}</div></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="funding-panel">
                    <div className="embedded-heading"><b>Rebates & customer balance</b><small>{isCiMode ? "C&I: STCs and margins are editable" : equipmentBrand === "sig" ? "SIG Residential: STCs are editable" : "Enter deductions as positive amounts"}</small></div>
                    <div className="funding-grid">
                      {stcIsEditable ? <ManualStcField label="Solar STC" value={result.solarStc} detail={`${result.solarCertificates} calculated certificates`} onChange={(v) => setField("manualSolarStc", Math.max(0, v))} /> : <Readout label="Solar STC" value={money.format(result.solarStc)} detail={`${result.solarCertificates} certificates × ${money.format(settings.solarStcUnitPrice)}`} />}
                      {stcIsEditable ? <ManualStcField label="Battery STC" value={result.batteryStc} detail={`${result.batteryCertificates} calculated certificates`} onChange={(v) => setField("manualBatteryStc", Math.max(0, v))} /> : <Readout label="Battery STC" value={money.format(result.batteryStc)} detail={`${result.batteryCertificates} certificates × ${money.format(settings.batteryStcUnitPrice)}`} />}
                      <Field label="Solar VIC Rebate"><NumberInput prefix="$" value={inputs.solarVicRebate} onChange={(v) => setField("solarVicRebate", Math.max(0, v))} /></Field>
                      <Field label="Solar VIC Interest Free Loan"><NumberInput prefix="$" value={inputs.solarVicLoan} onChange={(v) => setField("solarVicLoan", Math.max(0, v))} /></Field>
                      <div className="funding-final-row">
                        <Field label="Discount"><NumberInput prefix="$" value={inputs.discount} onChange={(v) => setField("discount", Math.max(0, v))} /></Field>
                        <Field label="Customer balance (incl. GST)"><NumberInput prefix="$" value={inputs.customerBalance} onChange={(v) => setField("customerBalance", v)} /></Field>
                      </div>
                      {!isCiMode && <div className="quick-margin-buttons funding-quick-margins">
                        <button type="button" onClick={() => applyMarginBalance(result.margin20RequiredBalance)}><b>20% Margin</b><span>{money.format(result.margin20RequiredBalance)}</span></button>
                        <button type="button" onClick={() => applyMarginBalance(result.margin15RequiredBalance)}><b>15% Margin</b><span>{money.format(result.margin15RequiredBalance)}</span></button>
                      </div>}
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
                <Metric label="Total sales price (excl. GST)" value={money.format(result.totalSalesPriceExGst)} />
                <Metric label="Net GST" value={money.format(result.netGst)} muted />
                <Metric label="Gross Margin" value={money.format(result.grossMargin)} accent />
              </section>

              <section className="customer-balance-summary" aria-label="Customer balance including GST">
                <span>Customer balance <small>(incl. GST)</small></span>
                <b>{money.format(inputs.customerBalance)}</b>
              </section>

              <div className="formula-note"><b>Calculation basis</b><p>Total received includes the customer balance, both STCs, Solar VIC Rebate and Interest Free Loan, less Discount.</p></div>
            </aside>
          </div>
        )}

        {tab === "history" && (
          <section className="panel standalone">
            <div className="section-heading history-heading"><div><span>◷</span><h2>Shared quotes</h2></div><div className="history-heading-actions">
              <small>Everyone can view and edit · admins can delete</small>
              <div className="quote-transfer-actions">
                <input ref={quoteImportRef} hidden type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" onChange={importQuotesFile} />
                <button type="button" className="quote-transfer-btn" disabled={quoteTransferBusy} onClick={() => quoteImportRef.current?.click()}>{quoteTransferBusy ? "Importing…" : "↓ Import"}</button>
                <button type="button" className="quote-transfer-btn export" disabled={quoteTransferBusy || session.quotes.length === 0} onClick={() => void exportQuotes()}>{quoteTransferBusy ? "Working…" : "↑ Export all"}</button>
              </div>
            </div></div>
            {session.quotes.length === 0 ? <EmptyState /> : (
              <>
                <label className="history-search">
                  <span aria-hidden="true">⌕</span>
                  <input type="search" value={quoteSearch} onChange={(event) => setQuoteSearch(event.target.value)} placeholder="Search by name, address or phone" aria-label="Search saved quotes" />
                  {quoteSearch && <button type="button" onClick={() => setQuoteSearch("")}>Clear</button>}
                </label>
                <div className="history-filter-bar" aria-label="Quote filters">
                  <label><span>Initiator</span><select value={quoteInitiatorFilter} onChange={(event) => setQuoteInitiatorFilter(event.target.value)}>
                    <option value="">All initiators</option>
                    {initiatorOptions.map((initiator) => <option key={initiator} value={initiator}>{initiator}</option>)}
                    <option value="__none__">No initiator</option>
                  </select></label>
                  <label><span>Status</span><select value={quoteStatusFilter} onChange={(event) => setQuoteStatusFilter(event.target.value as QuoteStatus | "")}>
                    <option value="">All statuses</option>
                    <option value="drafting">Drafting</option>
                    <option value="done">Done</option>
                  </select></label>
                  <label><span>Created from</span><input type="date" value={quoteCreatedFrom} max={quoteCreatedTo || undefined} onChange={(event) => setQuoteCreatedFrom(event.target.value)} /></label>
                  <label><span>Created to</span><input type="date" value={quoteCreatedTo} min={quoteCreatedFrom || undefined} onChange={(event) => setQuoteCreatedTo(event.target.value)} /></label>
                  <div className="history-filter-summary"><span>Showing <b>{filteredQuotes.length}</b> of {session.quotes.length}</span><button type="button" disabled={!hasHistoryFilters} onClick={clearHistoryFilters}>Clear filters</button></div>
                </div>
                {filteredQuotes.length === 0 ? (
                  <div className="empty search-empty"><span>⌕</span><h3>No matching quotes</h3><p>Try another search, Initiator, status or creation date range.</p></div>
                ) : (
                  <div className="history-list">{filteredQuotes.map((quote) => {
                    const calculated = calculateQuote(quote.payload, settings);
                    const openQuote = () => { setQuoteId(quote.id); setInputs(normalizeQuoteConfiguration({ ...quote.payload, mode: quote.payload.mode ?? "residential", discount: Math.abs(quote.payload.discount ?? 0), customItems: quote.payload.customItems ?? [], manualMargins: quote.payload.manualMargins ?? {} }, settings)); setTab("quote"); };
                    return <div className="history-row" key={quote.id}>
                      <button className="history-main" onClick={openQuote}>
                        <span className="history-customer"><b>{quote.projectName}{quote.payload.mode === "ci" && <em className="ci-badge">C&amp;I</em>}</b><small>{quote.payload.address || "No address entered"}</small><small>{quote.payload.phone || "No phone entered"} · Saved by {quote.ownerName}</small><small><strong>Initiator:</strong> {quote.payload.initiator?.trim() || "Not entered"} · <strong>Created:</strong> {quoteCreatedDateLabel(quote.createdAt)}</small></span>
                        <span className="history-config">
                          <span><em>Solar</em><b>{calculated.totalPvSize || "-"} kW</b></span>
                          <span><em>Battery</em><b>{calculated.totalBatteryKwh || "-"} kWh</b></span>
                          <span><em>Inverter</em><b>{quote.payload.mode === "ci" || quote.payload.equipmentBrand === "sig" ? calculated.inverterSummary : quote.payload.inverter || "No inverter selected"}</b></span>
                        </span>
                        <span className="history-margin"><b>{money.format(calculated.grossMargin)}</b><small className={`mini-status ${calculated.status}`}>{pct(calculated.grossMarginRate)}</small></span>
                        <span className="chevron">›</span>
                      </button>
                      <div className="history-actions">
                        <button type="button" className="export-quote-btn" disabled={quoteTransferBusy} onClick={() => void exportSingleQuote(quote)}>{quoteTransferBusy ? "Working…" : "Export"}</button>
                        <label className="history-status">
                          <span className="sr-only">Quote status</span>
                          <select className={quote.status} value={quote.status} disabled={statusBusyId === quote.id} onChange={(event) => void changeQuoteStatus(quote.id, event.target.value as QuoteStatus)}>
                            <option value="drafting">Drafting</option>
                            <option value="done">Done</option>
                          </select>
                        </label>
                        {isAdmin && <button type="button" className="delete-quote-btn" disabled={statusBusyId === quote.id} onClick={() => void removeQuote(quote.id, quote.projectName)}>Delete</button>}
                      </div>
                    </div>;
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
          <UsersPanel viewer={session.viewer} users={session.users} />
        )}
      </main>

      {message && <div className="toast">{message}</div>}
    </div>
  );
}

function LoginScreen({
  username,
  password,
  busy,
  error,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: {
  username: string;
  password: string;
  busy: boolean;
  error: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><span className="brand-logo-badge large" role="img" aria-label="E3 Energy" /><div><b>E3 Quoter</b><small>Quote and margin workspace</small></div></div>
        <div className="login-copy">
          <span>SECURE ACCESS</span>
          <h1 id="login-title">Sign in to continue</h1>
          <p>Use your assigned E3 Quoter account.</p>
        </div>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Username</span>
            <input autoFocus autoComplete="username" value={username} onChange={(event) => onUsernameChange(event.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => onPasswordChange(event.target.value)} />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="primary-btn login-submit" type="submit" disabled={busy || !username.trim() || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <small className="login-help">Contact an administrator if you cannot access your account.</small>
      </section>
    </main>
  );
}

function CiConfigGroup({ label, total, addLabel, disabled, onAdd, children }: {
  label: string;
  total: string;
  addLabel: string;
  disabled?: boolean;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return <section className="ci-config-group">
    <div className="ci-config-heading"><div><b>{label}</b><span>{total} total</span></div><button type="button" disabled={disabled} onClick={onAdd}>＋ {addLabel}</button></div>
    <div className="ci-config-rows">{children}</div>
  </section>;
}

function SigEquipmentGroup({ label, total, addLabel, items, options, required, onAdd, onUpdate, onRemove }: {
  label: string;
  total: string;
  addLabel: string;
  items: EquipmentSelection[];
  options: CatalogItem[];
  required?: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<EquipmentSelection>) => void;
  onRemove: (id: string) => void;
}) {
  return <CiConfigGroup label={label} total={total} addLabel={addLabel} disabled={!options.length} onAdd={onAdd}>
    {items.length === 0 && <div className="sig-selection-empty">No {label.toLowerCase()} added</div>}
    {items.map((item) => <div className="ci-config-row" key={item.id}>
      <Field label="Model"><select value={item.model} onChange={(event) => onUpdate(item.id, { model: event.target.value })}>{options.map((option) => <option key={option.name} value={option.name}>{option.name}</option>)}</select></Field>
      <Field label="Quantity"><NumberInput value={item.quantity} onChange={(value) => onUpdate(item.id, { quantity: value })} /></Field>
      <RemoveCiButton label={label.toLowerCase()} disabled={Boolean(required && items.length <= 1)} onClick={() => onRemove(item.id)} />
    </div>)}
  </CiConfigGroup>;
}

function RemoveCiButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return <button type="button" className="ci-remove-btn" aria-label={`Remove ${label}`} disabled={disabled} onClick={onClick}>×</button>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}

function NumberInput({ value, onChange, prefix, suffix, compact }: { value: number; onChange: (value: number) => void; prefix?: string; suffix?: string; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(inputNumber(value));

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
      value={editing ? draft : inputNumber(value)}
      placeholder="-"
      onFocus={() => { setEditing(true); setDraft(inputNumber(value)); }}
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

function ManualStcField({ label, value, detail, onChange }: { label: string; value: number; detail: string; onChange: (value: number) => void }) {
  return <div className="manual-stc-field"><Field label={label}><NumberInput prefix="$" value={value} onChange={onChange} /></Field><small>{detail} · manual amount</small></div>;
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
        <Field label="Senior approval threshold"><NumberInput value={settings.thresholds.approval * 100} suffix="%" onChange={(v) => update({ thresholds: { ...settings.thresholds, approval: percentageRate(v) } })} /></Field>
        <Field label="Target gross margin"><NumberInput value={settings.thresholds.target * 100} suffix="%" onChange={(v) => update({ thresholds: { ...settings.thresholds, target: percentageRate(v) } })} /></Field>
        <Field label="Solar STC unit price"><NumberInput value={settings.solarStcUnitPrice} prefix="$" onChange={(v) => update({ solarStcUnitPrice: v })} /></Field>
        <Field label="Battery STC unit price"><NumberInput value={settings.batteryStcUnitPrice} prefix="$" onChange={(v) => update({ batteryStcUnitPrice: v })} /></Field>
        <Field label="Battery installation cost"><NumberInput value={settings.batteryInstallCost} prefix="$" onChange={(v) => update({ batteryInstallCost: v })} /></Field>
        <Field label="Delivery cost"><NumberInput value={settings.deliveryCost} prefix="$" onChange={(v) => update({ deliveryCost: v })} /></Field>
        <Field label="Accessories unit cost"><NumberInput value={settings.accessoryCostPerKw} prefix="$" suffix="/ PV system kW" onChange={(v) => update({ accessoryCostPerKw: Math.max(0, v) })} /></Field>
        <Field label="Solar installation unit cost"><NumberInput value={settings.solarInstallCostPerKw} prefix="$" suffix="/ PV system kW" onChange={(v) => update({ solarInstallCostPerKw: Math.max(0, v) })} /></Field>
      </div>
    </section>
    <div className="catalog-split">
      <CatalogItemPanel letter="B" title="FOX Inverter" catalogKey="inverters" settings={settings} onChange={onChange} />
      <BatteryCatalogPanel letter="C" title="FOX Battery" catalogKey="batteries" settings={settings} onChange={onChange} />
    </div>
    <div className="catalog-split">
      <CatalogItemPanel letter="D" title="SIG Residential Inverter" catalogKey="sigResidentialInverters" settings={settings} onChange={onChange} showDescription />
      <BatteryCatalogPanel letter="E" title="SIG Residential Battery" catalogKey="sigResidentialBatteries" settings={settings} onChange={onChange} showDescription />
    </div>
    <div className="catalog-split">
      <CatalogItemPanel letter="F" title="SIG C&I Inverter" catalogKey="sigCiInverters" settings={settings} onChange={onChange} showDescription />
      <BatteryCatalogPanel letter="G" title="SIG C&I Battery" catalogKey="sigCiBatteries" settings={settings} onChange={onChange} showDescription />
    </div>
    <div className="catalog-split">
      <CatalogItemPanel letter="H" title="SIG Gateway" catalogKey="sigGateways" settings={settings} onChange={onChange} showDescription />
      <CatalogItemPanel letter="I" title="SIG Accessories" catalogKey="sigAccessories" settings={settings} onChange={onChange} showDescription />
    </div>
    <SigBatteryStcReferencePanel />
  </div>;
}

function SigBatteryStcReferencePanel() {
  return <section className="panel standalone sig-stc-reference-panel">
    <div className="section-heading"><div><span>J</span><h2>SIG Battery STC reference</h2></div><small>Display only · not used in calculations</small></div>
    <div className="sig-stc-reference-table" role="table" aria-label="SIG Battery STC reference">
      <div className="sig-stc-reference-head" role="row"><span role="columnheader">BAT kWh</span><span role="columnheader">STC</span></div>
      {sigBatteryStcReference.map((item, index) => item
        ? <div className="sig-stc-reference-row" role="row" key={`${item.batteryKwh}-${item.stc}-${index}`}><span role="cell">{item.batteryKwh}</span><span role="cell">{item.stc}</span></div>
        : <div className="sig-stc-reference-separator" aria-hidden="true" key={`separator-${index}`} />)}
    </div>
  </section>;
}

function CatalogItemPanel({ letter, title, catalogKey, settings, onChange, showDescription }: {
  letter: string;
  title: string;
  catalogKey: "inverters" | "sigResidentialInverters" | "sigCiInverters" | "sigGateways" | "sigAccessories";
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  showDescription?: boolean;
}) {
  const items = settings[catalogKey];
  return <section className="panel standalone">
    <div className="section-heading"><div><span>{letter}</span><h2>{title}</h2></div><small>{items.length} items · Our Price ex GST</small></div>
    <div className={`catalog-table ${showDescription ? "described" : ""}`}><div className="catalog-head"><span>Model</span>{showDescription && <span>Description</span>}<span>Our Price (excl. GST)</span></div>{items.map((item, index) => <div className="catalog-row" key={`${catalogKey}-${index}`}><input value={item.name} onChange={(event) => { const next = structuredClone(settings); next[catalogKey][index].name = event.target.value; onChange(next); }} />{showDescription && <input value={item.description ?? ""} onChange={(event) => { const next = structuredClone(settings); next[catalogKey][index].description = event.target.value; onChange(next); }} />}<NumberInput compact prefix="$" value={item.cost} onChange={(value) => { const next = structuredClone(settings); next[catalogKey][index].cost = value; onChange(next); }} /></div>)}</div>
  </section>;
}

function BatteryCatalogPanel({ letter, title, catalogKey, settings, onChange, showDescription }: {
  letter: string;
  title: string;
  catalogKey: "batteries" | "sigResidentialBatteries" | "sigCiBatteries";
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  showDescription?: boolean;
}) {
  const items = settings[catalogKey];
  return <section className="panel standalone">
    <div className="section-heading"><div><span>{letter}</span><h2>{title}</h2></div><small>{items.length} items · Capacity, price and STCs</small></div>
    <div className={`catalog-table battery ${showDescription ? "described" : ""}`}><div className="catalog-head"><span>Model</span>{showDescription && <span>Description</span>}<span>Capacity</span><span>Our Price</span><span>STCs</span></div>{items.map((item, index) => <div className="catalog-row" key={`${catalogKey}-${index}`}><input value={item.name} onChange={(event) => { const next = structuredClone(settings); next[catalogKey][index].name = event.target.value; onChange(next); }} />{showDescription && <input value={item.description ?? ""} onChange={(event) => { const next = structuredClone(settings); next[catalogKey][index].description = event.target.value; onChange(next); }} />}<NumberInput compact value={item.kwh} suffix="kWh" onChange={(value) => { const next = structuredClone(settings); next[catalogKey][index].kwh = value; onChange(next); }} /><NumberInput compact prefix="$" value={item.cost} onChange={(value) => { const next = structuredClone(settings); next[catalogKey][index].cost = value; onChange(next); }} /><NumberInput compact value={item.certificates} onChange={(value) => { const next = structuredClone(settings); next[catalogKey][index].certificates = value; onChange(next); }} /></div>)}</div>
  </section>;
}

function UsersPanel({ viewer, users }: { viewer: Viewer; users: UserRow[] }) {
  return <section className="panel standalone">
    <div className="section-heading"><div><span>U</span><h2>User access</h2></div><small>Account roles are fixed</small></div>
    <div className="user-list">{users.map((user) => <div key={user.userId} className="user-row"><div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div className="user-info"><b>{user.displayName}{user.userId === viewer.userId && <em>You</em>}</b><small>{user.email}</small></div><span className={`role-badge ${user.role}`}>{user.role === "admin" ? "Administrator" : "Standard user"}</span></div>)}</div>
    <div className="permission-note"><b>Access rules</b><p>Standard users can edit customer and project details, rebates, discounts and site-specific costs. Only administrators can change equipment catalogues, base costs, STC prices and margin thresholds.</p></div>
  </section>;
}
