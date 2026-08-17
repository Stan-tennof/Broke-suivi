import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Archive, Boxes, ChevronRight, CircleAlert, History, LogOut, PackageSearch,
  RefreshCw, Search, Settings, SlidersHorizontal, UserRound, Users,
} from "lucide-react";
import { actionLabel, validateAdjustment } from "./lib/domain";
import { isConfigured, supabase } from "./lib/supabase";
import type {
  AppRole, Channel, Chest, ChestInventoryItem, InventoryItem,
  PlayerActivity, SyncRun, Transaction,
} from "./lib/types";

type Tab = "global" | "chests" | "history" | "players" | "admin";
type Notice = { kind: "success" | "error"; text: string } | null;

const dateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Jamais";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMessage(error ? error.message : "");
  };
  return <main className="login-shell">
    <form className="login-panel" onSubmit={submit}>
      <div className="brand-mark"><Archive size={24} /></div>
      <h1>Inventaire des coffres</h1>
      <p>Connectez-vous avec votre compte autorisé.</p>
      {!isConfigured && <div className="notice error">Variables Supabase publiques manquantes.</div>}
      <label>Adresse courriel<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {message && <div className="notice error">{message}</div>}
      <button className="primary" type="submit">Se connecter <ChevronRight size={17} /></button>
    </form>
  </main>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState<AppRole | null>(null);
  const [tab, setTab] = useState<Tab>("global");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [globalItems, setGlobalItems] = useState<InventoryItem[]>([]);
  const [chestItems, setChestItems] = useState<ChestInventoryItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [players, setPlayers] = useState<PlayerActivity[]>([]);
  const [chests, setChests] = useState<Chest[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [lastRun, setLastRun] = useState<SyncRun | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!session?.user.email) return;
    setLoading(true);
    const email = session.user.email.toLowerCase();
    const [access, global, byChest, history, activity, chestRows, channelRows, runRows] = await Promise.all([
      supabase.from("app_users").select("role, active").eq("email", email).maybeSingle(),
      supabase.from("inventory_global").select("*").order("item_name"),
      supabase.from("inventory_by_chest").select("*").order("chest_name").order("item_name"),
      supabase.from("transactions").select("id,discord_message_id,discord_webhook_id,discord_channel_id,chest_name,player_name,action,quantity,signed_delta,item_name,discord_timestamp,source,justification").order("discord_timestamp", { ascending: false }).limit(5000),
      supabase.from("player_activity").select("*").order("deposited", { ascending: false }),
      supabase.from("webhook_chests").select("webhook_id,canonical_name,detected_name,capacity_kg,active").order("canonical_name"),
      supabase.from("discord_channels").select("channel_id,label,active,last_message_id,last_synced_at,last_error").order("label"),
      supabase.from("sync_runs").select("completed_at,imported,ignored,duplicates,errors").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!access.data?.active) {
      setRole(null);
      setNotice({ kind: "error", text: "Ce compte n’est pas autorisé à consulter le dashboard." });
    } else {
      setRole(access.data.role as AppRole);
    }
    const firstError = [global, byChest, history, activity, chestRows, channelRows, runRows].find((query) => query.error)?.error;
    if (firstError) setNotice({ kind: "error", text: firstError.message });
    setGlobalItems((global.data ?? []) as InventoryItem[]);
    setChestItems((byChest.data ?? []) as ChestInventoryItem[]);
    setTransactions((history.data ?? []) as Transaction[]);
    setPlayers((activity.data ?? []) as PlayerActivity[]);
    setChests((chestRows.data ?? []) as Chest[]);
    setChannels((channelRows.data ?? []) as Channel[]);
    setLastRun(runRows.data as SyncRun | null);
    setLoading(false);
  }, [session]);

  useEffect(() => { void loadData(); }, [loadData]);

  const runSync = async (historical = false) => {
    setLoading(true);
    setNotice(null);
    const { data, error } = await supabase.functions.invoke("discord-sync", {
      body: historical ? { mode: "historical" } : {},
    });
    if (error) setNotice({ kind: "error", text: error.message });
    else setNotice({
      kind: data.errors?.length ? "error" : "success",
      text: `Synchronisation terminée : ${data.imported} nouveaux mouvements importés, ${data.ignored} messages ignorés, ${data.duplicates} doublons.`,
    });
    await loadData();
  };

  if (!authReady) return <div className="loading-screen"><RefreshCw className="spin" /></div>;
  if (!session) return <Login />;

  const nav: { id: Tab; label: string; icon: typeof Boxes }[] = [
    { id: "global", label: "Vue globale", icon: Boxes },
    { id: "chests", label: "Par coffre", icon: Archive },
    { id: "history", label: "Historique", icon: History },
    { id: "players", label: "Joueurs", icon: Users },
    ...(role === "admin" ? [{ id: "admin" as Tab, label: "Administration", icon: Settings }] : []),
  ];

  return <div className="app-shell">
    <aside>
      <div className="brand"><div className="brand-mark"><Archive size={20} /></div><span>Coffres</span></div>
      <nav>{nav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><item.icon size={18} /><span>{item.label}</span></button>)}</nav>
      <div className="account"><UserRound size={18} /><div><strong>{session.user.email}</strong><span>{role === "admin" ? "Administrateur" : "Consultation"}</span></div><button title="Déconnexion" onClick={() => supabase.auth.signOut()}><LogOut size={17} /></button></div>
    </aside>
    <main className="content">
      <header><div><span className="eyebrow">Suivi Discord</span><h1>{nav.find((item) => item.id === tab)?.label}</h1></div>{role === "admin" && <button className="primary" onClick={() => runSync()} disabled={loading}><RefreshCw size={17} className={loading ? "spin" : ""} /> Actualiser maintenant</button>}</header>
      {notice && <div className={`notice ${notice.kind}`}><CircleAlert size={18} />{notice.text}</div>}
      {tab === "global" && <GlobalView items={globalItems} lastRun={lastRun} transactions={transactions} />}
      {tab === "chests" && <ChestView items={chestItems} />}
      {tab === "history" && <HistoryView transactions={transactions} chests={chests} />}
      {tab === "players" && <PlayersView players={players} transactions={transactions} />}
      {tab === "admin" && role === "admin" && <AdminView chests={chests} channels={channels} reload={loadData} runHistorical={() => runSync(true)} />}
    </main>
  </div>;
}

function GlobalView({ items, lastRun, transactions }: { items: InventoryItem[]; lastRun: SyncRun | null; transactions: Transaction[] }) {
  const [search, setSearch] = useState("");
  const shown = items.filter((item) => item.item_name.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")));
  const deposits = transactions.filter((row) => row.signed_delta > 0).reduce((sum, row) => sum + row.signed_delta, 0);
  const withdrawals = Math.abs(transactions.filter((row) => row.signed_delta < 0).reduce((sum, row) => sum + row.signed_delta, 0));
  return <>
    <section className="metrics"><Metric label="Items suivis" value={items.length} /><Metric label="Unités en stock" value={items.reduce((sum, item) => sum + Number(item.quantity), 0)} /><Metric label="Total déposé" value={deposits} tone="positive" /><Metric label="Total retiré" value={withdrawals} tone="negative" /></section>
    <section className="toolbar"><div className="search"><Search size={17} /><input placeholder="Rechercher un item" value={search} onChange={(e) => setSearch(e.target.value)} /></div><span>Dernière synchro : {dateTime(lastRun?.completed_at)}</span></section>
    <section className="table-panel"><TableEmpty visible={!shown.length} /><table><thead><tr><th>Item</th><th className="number">Quantité actuelle</th></tr></thead><tbody>{shown.map((item) => <tr key={item.item_name}><td><strong>{item.item_name}</strong></td><td className="number stock">{item.quantity}</td></tr>)}</tbody></table></section>
  </>;
}

function ChestView({ items }: { items: ChestInventoryItem[] }) {
  const groups = useMemo(() => {
    const result = new Map<string, ChestInventoryItem[]>();
    for (const item of items) {
      const key = item.webhook_id ?? item.chest_name;
      result.set(key, [...(result.get(key) ?? []), item]);
    }
    return result;
  }, [items]);
  return <div className="chest-grid">{[...groups.entries()].map(([id, rows]) => {
    const total = rows.reduce((sum, row) => sum + Number(row.quantity), 0);
    const max = Math.max(...rows.map((row) => Number(row.quantity)), 1);
    return <article className="chest-panel" key={id}><header><div><h2>{rows[0].chest_name}</h2><span>Webhook {id}</span></div>{rows[0].capacity_kg && <span className="capacity">{rows[0].capacity_kg} kg</span>}</header><div className="chest-summary"><strong>{total}</strong><span>unités · dernier mouvement {dateTime(rows[0].last_movement_at)}</span></div><div className="stock-list">{rows.map((row) => <div key={row.item_name}><div><span>{row.item_name}</span><strong>{row.quantity}</strong></div><div className="bar"><i style={{ width: `${Math.max(3, Number(row.quantity) / max * 100)}%` }} /></div></div>)}</div></article>;
  })}<TableEmpty visible={!items.length} /></div>;
}

function HistoryView({ transactions, chests }: { transactions: Transaction[]; chests: Chest[] }) {
  const [filters, setFilters] = useState({ player: "", chest: "", item: "", action: "", start: "", end: "" });
  const filtered = transactions.filter((row) => {
    const when = row.discord_timestamp.slice(0, 10);
    return (!filters.player || row.player_name.toLocaleLowerCase("fr").includes(filters.player.toLocaleLowerCase("fr")))
      && (!filters.chest || row.discord_webhook_id === filters.chest)
      && (!filters.item || row.item_name.toLocaleLowerCase("fr").includes(filters.item.toLocaleLowerCase("fr")))
      && (!filters.action || row.action === filters.action)
      && (!filters.start || when >= filters.start) && (!filters.end || when <= filters.end);
  });
  const set = (name: string, value: string) => setFilters((current) => ({ ...current, [name]: value }));
  return <><section className="filters"><SlidersHorizontal size={18} /><input placeholder="Joueur" onChange={(e) => set("player", e.target.value)} /><select onChange={(e) => set("chest", e.target.value)}><option value="">Tous les coffres</option>{chests.map((chest) => <option key={chest.webhook_id} value={chest.webhook_id}>{chest.canonical_name}</option>)}</select><input placeholder="Item" onChange={(e) => set("item", e.target.value)} /><select onChange={(e) => set("action", e.target.value)}><option value="">Toutes les actions</option><option value="deposit">Dépôts</option><option value="withdrawal">Retraits</option><option value="adjustment">Ajustements</option></select><input type="date" onChange={(e) => set("start", e.target.value)} /><input type="date" onChange={(e) => set("end", e.target.value)} /></section><section className="table-panel scroll"><TableEmpty visible={!filtered.length} /><table><thead><tr><th>Date</th><th>Joueur</th><th>Coffre</th><th>Item</th><th>Action</th><th className="number">Quantité</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{dateTime(row.discord_timestamp)}</td><td>{row.player_name}</td><td>{chests.find((chest) => chest.webhook_id === row.discord_webhook_id)?.canonical_name ?? row.chest_name}</td><td>{row.item_name}</td><td><span className={`action ${row.action}`}>{actionLabel(row.action)}</span></td><td className={`number ${row.signed_delta > 0 ? "positive" : "negative"}`}>{row.signed_delta > 0 ? "+" : ""}{row.signed_delta}</td></tr>)}</tbody></table></section></>;
}

function PlayersView({ players, transactions }: { players: PlayerActivity[]; transactions: Transaction[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const details = transactions.filter((row) => row.player_name === selected);
  return <div className="players-layout"><section className="table-panel"><table><thead><tr><th>Joueur</th><th className="number">Déposé</th><th className="number">Retiré</th><th className="number">Mouvements</th></tr></thead><tbody>{players.map((player) => <tr key={player.player_name} onClick={() => setSelected(player.player_name)} className={selected === player.player_name ? "selected" : ""}><td><strong>{player.player_name}</strong></td><td className="number positive">+{player.deposited}</td><td className="number negative">-{player.withdrawn}</td><td className="number">{player.movement_count}</td></tr>)}</tbody></table></section><section className="detail-panel"><h2>{selected ?? "Détail du joueur"}</h2>{selected ? details.slice(0, 50).map((row) => <div className="movement" key={row.id}><div><strong>{row.item_name}</strong><span>{dateTime(row.discord_timestamp)} · {row.chest_name}</span></div><b className={row.signed_delta > 0 ? "positive" : "negative"}>{row.signed_delta > 0 ? "+" : ""}{row.signed_delta}</b></div>) : <div className="empty"><Users size={28} /><span>Sélectionnez un joueur.</span></div>}</section></div>;
}

function AdminView({ chests, channels, reload, runHistorical }: { chests: Chest[]; channels: Channel[]; reload: () => Promise<void>; runHistorical: () => Promise<void> }) {
  const [adjustment, setAdjustment] = useState({ webhook: "", item: "", delta: "", reason: "" });
  const [channel, setChannel] = useState({ id: "", label: "" });
  const [message, setMessage] = useState("");
  const addAdjustment = async (event: FormEvent) => {
    event.preventDefault(); const delta = Number(adjustment.delta); const validation = validateAdjustment(delta, adjustment.reason);
    if (validation) return setMessage(validation);
    const { error } = await supabase.rpc("create_manual_adjustment", { p_webhook_id: adjustment.webhook, p_item_name: adjustment.item, p_delta: delta, p_justification: adjustment.reason });
    setMessage(error?.message ?? "Ajustement enregistré."); if (!error) { setAdjustment({ webhook: "", item: "", delta: "", reason: "" }); await reload(); }
  };
  const addChannel = async (event: FormEvent) => {
    event.preventDefault(); const { error } = await supabase.from("discord_channels").upsert({ channel_id: channel.id.trim(), label: channel.label.trim() });
    setMessage(error?.message ?? "Salon enregistré."); if (!error) { setChannel({ id: "", label: "" }); await reload(); }
  };
  const updateChest = async (chest: Chest, values: Partial<Chest>) => { await supabase.from("webhook_chests").update(values).eq("webhook_id", chest.webhook_id); await reload(); };
  return <div className="admin-grid">{message && <div className="notice success full">{message}</div>}<section className="admin-panel"><h2>Ajustement manuel</h2><form onSubmit={addAdjustment}><label>Coffre<select required value={adjustment.webhook} onChange={(e) => setAdjustment({ ...adjustment, webhook: e.target.value })}><option value="">Sélectionner</option>{chests.filter((c) => c.active).map((c) => <option key={c.webhook_id} value={c.webhook_id}>{c.canonical_name}</option>)}</select></label><label>Item<input required value={adjustment.item} onChange={(e) => setAdjustment({ ...adjustment, item: e.target.value })} /></label><label>Variation<input required type="number" step="1" value={adjustment.delta} onChange={(e) => setAdjustment({ ...adjustment, delta: e.target.value })} /></label><label>Justification<textarea required value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} /></label><button className="primary"><PackageSearch size={17} /> Enregistrer</button></form></section><section className="admin-panel"><h2>Salons Discord</h2><form className="inline-form" onSubmit={addChannel}><input placeholder="ID du salon" required pattern="[0-9]+" value={channel.id} onChange={(e) => setChannel({ ...channel, id: e.target.value })} /><input placeholder="Nom" required value={channel.label} onChange={(e) => setChannel({ ...channel, label: e.target.value })} /><button className="icon-button" title="Ajouter le salon"><ChevronRight /></button></form>{channels.map((row) => <div className="admin-row" key={row.channel_id}><div><strong>{row.label}</strong><span>{row.channel_id} · {dateTime(row.last_synced_at)}</span>{row.last_error && <small>{row.last_error}</small>}</div><label className="toggle"><input type="checkbox" checked={row.active} onChange={async (e) => { await supabase.from("discord_channels").update({ active: e.target.checked }).eq("channel_id", row.channel_id); await reload(); }} /><i /></label></div>)}<button className="secondary wide" onClick={runHistorical}><RefreshCw size={17} /> Relancer l’import historique</button></section><section className="admin-panel full"><h2>Webhooks et coffres</h2>{chests.map((chest) => <div className="mapping-row" key={chest.webhook_id}><div><span>Webhook {chest.webhook_id}</span><small>Détecté : {chest.detected_name}</small></div><input aria-label="Nom canonique" defaultValue={chest.canonical_name} onBlur={(e) => e.target.value !== chest.canonical_name && updateChest(chest, { canonical_name: e.target.value.trim() })} /><input aria-label="Capacité" type="number" defaultValue={chest.capacity_kg ?? ""} onBlur={(e) => updateChest(chest, { capacity_kg: e.target.value ? Number(e.target.value) : null })} /><label className="toggle"><input type="checkbox" checked={chest.active} onChange={(e) => updateChest(chest, { active: e.target.checked })} /><i /></label></div>)}</section></div>;
}

function Metric({ label, value, tone = "" }: { label: string; value: number; tone?: string }) { return <article className="metric"><span>{label}</span><strong className={tone}>{value.toLocaleString("fr-CA")}</strong></article>; }
function TableEmpty({ visible }: { visible: boolean }) { return visible ? <div className="empty"><PackageSearch size={28} /><span>Aucune donnée à afficher.</span></div> : null; }
