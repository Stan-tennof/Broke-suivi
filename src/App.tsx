import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Archive, ArchiveX, Banknote, Boxes, ChevronRight, CircleAlert, CircleHelp, History, LogOut,
  PackageSearch, RefreshCw, Save, Scale, Search, Settings, SlidersHorizontal,
  UserRound, Users,
} from "lucide-react";
import { actionLabel, adjustmentToTarget, calculateChestWeight, formatMoney, formatWeight, isMoneyItem, validateAdjustment } from "./lib/domain";
import { isConfigured, supabase } from "./lib/supabase";
import type {
  AppRole, Channel, Chest, ChestInventoryItem, InventoryItem, ItemWeight,
  PlayerActivity, SyncRun, Transaction,
} from "./lib/types";

type Tab = "global" | "chests" | "weights" | "history" | "players" | "admin";
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
  const [itemWeights, setItemWeights] = useState<ItemWeight[]>([]);
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
    const [access, global, byChest, weights, history, activity, chestRows, channelRows, runRows] = await Promise.all([
      supabase.from("app_users").select("role, active").eq("email", email).maybeSingle(),
      supabase.from("inventory_global").select("*").order("item_name"),
      supabase.from("inventory_by_chest").select("*").order("chest_name").order("item_name"),
      supabase.from("item_weights").select("item_name,weight_kg,updated_at").order("item_name"),
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
    const firstError = [global, byChest, weights, history, activity, chestRows, channelRows, runRows].find((query) => query.error)?.error;
    if (firstError) setNotice({ kind: "error", text: firstError.message });
    setGlobalItems((global.data ?? []) as InventoryItem[]);
    setChestItems((byChest.data ?? []) as ChestInventoryItem[]);
    setItemWeights((weights.data ?? []) as ItemWeight[]);
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
    { id: "weights", label: "Poids des items", icon: Scale },
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
      {tab === "global" && <GlobalView items={globalItems} lastRun={lastRun} />}
      {tab === "chests" && <ChestView items={chestItems} weights={itemWeights} chests={chests} transactions={transactions} role={role} reload={loadData} />}
      {tab === "weights" && <WeightsView transactions={transactions} weights={itemWeights} role={role} reload={loadData} />}
      {tab === "history" && <HistoryView transactions={transactions} chests={chests} />}
      {tab === "players" && <PlayersView players={players} transactions={transactions} />}
      {tab === "admin" && role === "admin" && <AdminView chests={chests} channels={channels} reload={loadData} runHistorical={() => runSync(true)} />}
    </main>
  </div>;
}

function GlobalView({ items, lastRun }: { items: InventoryItem[]; lastRun: SyncRun | null }) {
  const [search, setSearch] = useState("");
  const physicalItems = items.filter((item) => !isMoneyItem(item.item_name));
  const shown = physicalItems.filter((item) => item.item_name.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")));
  const cleanMoney = items.filter((item) => item.item_name.trim().toLocaleLowerCase("fr") === "argent").reduce((sum, item) => sum + Number(item.quantity), 0);
  const dirtyMoney = items.filter((item) => item.item_name.trim().toLocaleLowerCase("fr") === "argent sale").reduce((sum, item) => sum + Number(item.quantity), 0);
  return <>
    <section className="metrics"><Metric label="Items suivis" value={physicalItems.length} /><Metric label="Unités en stock" value={physicalItems.reduce((sum, item) => sum + Number(item.quantity), 0)} /><Metric label="Argent" value={formatMoney(cleanMoney)} tone="money-clean" /><Metric label="Argent sale" value={formatMoney(dirtyMoney)} tone="money-dirty" /></section>
    <section className="toolbar"><div className="search"><Search size={17} /><input placeholder="Rechercher un item" value={search} onChange={(e) => setSearch(e.target.value)} /></div><span>Dernière synchro : {dateTime(lastRun?.completed_at)}</span></section>
    <section className="table-panel"><TableEmpty visible={!shown.length} /><table><thead><tr><th>Item</th><th className="number">Quantité actuelle</th></tr></thead><tbody>{shown.map((item) => <tr key={item.item_name}><td><strong>{item.item_name}</strong></td><td className="number stock">{item.quantity}</td></tr>)}</tbody></table></section>
  </>;
}

function ChestView({ items, weights, chests, transactions, role, reload }: { items: ChestInventoryItem[]; weights: ItemWeight[]; chests: Chest[]; transactions: Transaction[]; role: AppRole | null; reload: () => Promise<void> }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [emptying, setEmptying] = useState<string | null>(null);
  const [message, setMessage] = useState<Notice>(null);
  const weightByItem = useMemo(() => new Map(weights.map((weight) => [weight.item_name, weight.weight_kg])), [weights]);
  const activeChests = chests.filter((chest) => chest.active);
  const emptyChest = async (chest: Chest) => {
    setEmptying(chest.webhook_id);
    setMessage(null);
    const { data, error } = await supabase.rpc("empty_chest", {
      p_webhook_id: chest.webhook_id,
      p_justification: "Coffre déclaré vide depuis le dashboard",
    });
    if (error) {
      setMessage({ kind: "error", text: error.message });
    } else {
      const count = Number(data);
      setMessage({ kind: "success", text: `${chest.canonical_name} a été remis à zéro (${count} ajustement${count === 1 ? "" : "s"}).` });
      await reload();
    }
    setConfirming(null);
    setEmptying(null);
  };
  return <>{message && <div className={`notice ${message.kind}`}><CircleAlert size={18} />{message.text}</div>}<div className="chest-grid">{activeChests.map((chest) => {
    const id = chest.webhook_id;
    const rows = items.filter((item) => item.webhook_id === id);
    const physicalRows = rows.filter((row) => !isMoneyItem(row.item_name));
    const moneyRows = rows.filter((row) => isMoneyItem(row.item_name));
    const capacity = chest.capacity_kg == null ? null : Number(chest.capacity_kg);
    const summary = calculateChestWeight(physicalRows, weights, capacity);
    const lastMovement = transactions.find((row) => row.discord_webhook_id === id)?.discord_timestamp;
    return <article className="chest-panel" key={id}>
      <header><div><h2>{chest.canonical_name}</h2><span>Stock calculé depuis Discord · mis à jour {dateTime(lastMovement)}</span></div>{role === "admin" && <div className="chest-actions">{confirming === id ? <div className="empty-confirm"><span>Confirmer la remise à zéro?</span><button className="danger-button" onClick={() => void emptyChest(chest)} disabled={emptying === id}>Confirmer</button><button className="secondary compact" onClick={() => setConfirming(null)} disabled={emptying === id}>Annuler</button></div> : <button className="secondary empty-button" onClick={() => setConfirming(id)}><ArchiveX size={16} /> Vider le coffre</button>}</div>}</header>
      <div className="weight-metrics">
        <div><span>Capacité max.</span><strong>{capacity == null ? "Non définie" : formatWeight(capacity)}</strong></div>
        <div><span>Poids calculé</span><strong>{formatWeight(summary.knownWeightKg)}</strong></div>
        <div><span>{summary.isComplete ? "Espace restant" : "Maximum disponible"}</span><strong className={summary.remainingKg != null && summary.remainingKg < 0 ? "negative" : ""}>{summary.remainingKg == null ? "Indéterminé" : formatWeight(summary.remainingKg)}</strong></div>
      </div>
      {!summary.isComplete && <div className="weight-warning"><CircleHelp size={16} /><span>{summary.unknownItemCount} poids à renseigner ({summary.unknownUnitCount} unités). Le poids total est partiel.</span></div>}
      {moneyRows.length > 0 && <div className="money-section"><div className="money-title"><Banknote size={17} /><span>Argent</span></div>{moneyRows.map((row) => <div className="money-line" key={row.item_name}><span>{row.item_name}</span><strong className={Number(row.quantity) < 0 ? "negative" : ""}>{formatMoney(Number(row.quantity))}</strong></div>)}</div>}
      <div className="stock-heading"><span>Contenu calculé</span><strong>{physicalRows.length} item{physicalRows.length === 1 ? "" : "s"}</strong></div>
      <div className="stock-list weighted">{physicalRows.length === 0 && <div className="empty-stock"><ArchiveX size={20} /><span>Coffre vide</span></div>}{physicalRows.map((row) => {
        const unitWeight = weightByItem.get(row.item_name);
        const lineWeight = unitWeight == null ? null : Math.max(0, Number(row.quantity)) * Number(unitWeight);
        const latest = transactions.find((transaction) => transaction.discord_webhook_id === id && transaction.item_name === row.item_name);
        return <div className="stock-entry" key={row.item_name}>
          <div className="stock-line">
            <div className="stock-name"><strong>{row.item_name}</strong><span>{latest ? `Dernier: ${actionLabel(latest.action).toLocaleLowerCase("fr")} ${latest.signed_delta > 0 ? "+" : ""}${latest.signed_delta} · ${dateTime(latest.discord_timestamp)}` : "Aucun mouvement récent"}</span></div>
            <div className="stock-value">{role === "admin" ? <InlineQuantityEditor webhookId={id} itemName={row.item_name} quantity={Number(row.quantity)} reload={reload} onNotice={setMessage} /> : <strong className={Number(row.quantity) < 0 ? "negative" : ""}>{row.quantity} unités</strong>}<span>{lineWeight == null ? "Poids inconnu" : `${lineWeight === 0 ? "0 kg" : formatWeight(lineWeight)} · ${formatWeight(Number(unitWeight))}/u`}</span></div>
          </div>
        </div>;
      })}</div>
    </article>;
  })}<TableEmpty visible={!activeChests.length} /></div></>;
}

function InlineQuantityEditor({ webhookId, itemName, quantity, reload, onNotice }: { webhookId: string; itemName: string; quantity: number; reload: () => Promise<void>; onNotice: (notice: Notice) => void }) {
  const [value, setValue] = useState(String(quantity));
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(String(quantity)), [quantity]);
  const save = async () => {
    if (saving) return;
    const target = value.trim() === "" ? Number.NaN : Number(value);
    const delta = adjustmentToTarget(quantity, target);
    if (delta == null) {
      setValue(String(quantity));
      onNotice({ kind: "error", text: "La quantité doit être un nombre entier positif ou zéro." });
      return;
    }
    if (delta === 0) return;
    setSaving(true);
    const { error } = await supabase.rpc("create_manual_adjustment", {
      p_webhook_id: webhookId,
      p_item_name: itemName,
      p_delta: delta,
      p_justification: `Correction inventaire physique: ${quantity} vers ${target}`,
    });
    if (error) {
      setValue(String(quantity));
      onNotice({ kind: "error", text: error.message });
    } else {
      onNotice({ kind: "success", text: `${itemName} corrigé à ${target}.` });
      await reload();
    }
    setSaving(false);
  };
  return <div className={`inline-quantity ${value !== String(quantity) ? "changed" : ""}`}><input aria-label={`Quantité réelle de ${itemName}`} title="Modifier puis appuyer sur Entrée" type="number" min="0" step="1" value={value} disabled={saving} onChange={(event) => setValue(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><b>unités</b>{saving && <RefreshCw size={14} className="spin" />}</div>;
}

function WeightsView({ transactions, weights, role, reload }: { transactions: Transaction[]; weights: ItemWeight[]; role: AppRole | null; reload: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const itemNames = useMemo(() => [...new Set([
    ...transactions.map((transaction) => transaction.item_name),
    ...weights.map((weight) => weight.item_name),
  ].filter((item) => !isMoneyItem(item)))].sort((a, b) => a.localeCompare(b, "fr")), [transactions, weights]);
  const weightByItem = new Map(weights.map((weight) => [weight.item_name, weight]));
  const shown = itemNames.filter((item) => item.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")));
  const pending = itemNames.filter((item) => weightByItem.get(item)?.weight_kg == null).length;
  return <>
    <section className="weight-catalog-summary"><div><strong>{itemNames.length}</strong><span>items connus</span></div><div><strong>{itemNames.length - pending}</strong><span>poids renseignés</span></div><div><strong>{pending}</strong><span>en attente</span></div></section>
    <section className="toolbar"><div className="search"><Search size={17} /><input placeholder="Rechercher un item" value={search} onChange={(e) => setSearch(e.target.value)} /></div><span>Poids exprimés en kilogrammes par unité</span></section>
    <section className="table-panel weights-table"><table><thead><tr><th>Item</th><th>Poids unitaire</th><th>Statut</th>{role === "admin" && <th className="number">Action</th>}</tr></thead><tbody>{shown.map((item) => <WeightRow key={item} item={item} weight={weightByItem.get(item) ?? null} editable={role === "admin"} reload={reload} />)}</tbody></table><TableEmpty visible={!shown.length} /></section>
  </>;
}

function WeightRow({ item, weight, editable, reload }: { item: string; weight: ItemWeight | null; editable: boolean; reload: () => Promise<void> }) {
  const [value, setValue] = useState(weight?.weight_kg?.toString() ?? "");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  useEffect(() => setValue(weight?.weight_kg?.toString() ?? ""), [weight?.weight_kg]);
  const save = async () => {
    const parsed = value.trim() === "" ? null : Number(value);
    if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0)) { setState("error"); return; }
    setState("saving");
    const { error } = await supabase.from("item_weights").upsert({ item_name: item, weight_kg: parsed, updated_at: new Date().toISOString() });
    setState(error ? "error" : "idle");
    if (!error) await reload();
  };
  return <tr><td><strong>{item}</strong></td><td>{editable ? <div className="weight-input"><input aria-label={`Poids de ${item}`} type="number" min="0.001" step="0.001" placeholder="À renseigner" value={value} onChange={(event) => { setValue(event.target.value); setState("idle"); }} /><span>kg</span></div> : weight?.weight_kg == null ? "—" : formatWeight(Number(weight.weight_kg))}</td><td><span className={`weight-status ${weight?.weight_kg == null ? "pending" : "known"}`}>{weight?.weight_kg == null ? "À renseigner" : "Connu"}</span>{state === "error" && <small className="field-error">Poids invalide</small>}</td>{editable && <td className="number"><button className="icon-button save-weight" title={`Enregistrer le poids de ${item}`} onClick={save} disabled={state === "saving"}><Save size={17} /></button></td>}</tr>;
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
  return <><section className="filters"><SlidersHorizontal size={18} /><input placeholder="Joueur" onChange={(e) => set("player", e.target.value)} /><select onChange={(e) => set("chest", e.target.value)}><option value="">Tous les coffres</option>{chests.map((chest) => <option key={chest.webhook_id} value={chest.webhook_id}>{chest.canonical_name}</option>)}</select><input placeholder="Item" onChange={(e) => set("item", e.target.value)} /><select onChange={(e) => set("action", e.target.value)}><option value="">Toutes les actions</option><option value="deposit">Dépôts</option><option value="withdrawal">Retraits</option><option value="adjustment">Ajustements</option></select><input type="date" onChange={(e) => set("start", e.target.value)} /><input type="date" onChange={(e) => set("end", e.target.value)} /></section><section className="table-panel scroll"><TableEmpty visible={!filtered.length} /><table><thead><tr><th>Date</th><th>Joueur</th><th>Coffre</th><th>Item</th><th>Action</th><th className="number">Quantité</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{dateTime(row.discord_timestamp)}</td><td>{row.player_name}</td><td>{chests.find((chest) => chest.webhook_id === row.discord_webhook_id)?.canonical_name ?? row.chest_name}</td><td>{row.item_name}</td><td><span className={`action ${row.action}`}>{actionLabel(row.action)}</span></td><td className={`number ${row.signed_delta > 0 ? "positive" : "negative"}`}>{isMoneyItem(row.item_name) ? formatMoney(row.signed_delta) : `${row.signed_delta > 0 ? "+" : ""}${row.signed_delta}`}</td></tr>)}</tbody></table></section></>;
}

function PlayersView({ players, transactions }: { players: PlayerActivity[]; transactions: Transaction[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const details = transactions.filter((row) => row.player_name === selected);
  return <div className="players-layout"><section className="table-panel"><table><thead><tr><th>Joueur</th><th className="number">Objets +</th><th className="number">Objets -</th><th className="number">Argent net</th></tr></thead><tbody>{players.map((player) => {
    const rows = transactions.filter((row) => row.player_name === player.player_name);
    const itemDeposits = rows.filter((row) => !isMoneyItem(row.item_name) && row.signed_delta > 0).reduce((sum, row) => sum + row.signed_delta, 0);
    const itemWithdrawals = Math.abs(rows.filter((row) => !isMoneyItem(row.item_name) && row.signed_delta < 0).reduce((sum, row) => sum + row.signed_delta, 0));
    const moneyNet = rows.filter((row) => isMoneyItem(row.item_name)).reduce((sum, row) => sum + row.signed_delta, 0);
    return <tr key={player.player_name} onClick={() => setSelected(player.player_name)} className={selected === player.player_name ? "selected" : ""}><td><strong>{player.player_name}</strong></td><td className="number positive">+{itemDeposits}</td><td className="number negative">-{itemWithdrawals}</td><td className={`number ${moneyNet >= 0 ? "positive" : "negative"}`}>{formatMoney(moneyNet)}</td></tr>;
  })}</tbody></table></section><section className="detail-panel"><h2>{selected ?? "Détail du joueur"}</h2>{selected ? details.slice(0, 50).map((row) => <div className="movement" key={row.id}><div><strong>{row.item_name}</strong><span>{dateTime(row.discord_timestamp)} · {row.chest_name}</span></div><b className={row.signed_delta > 0 ? "positive" : "negative"}>{isMoneyItem(row.item_name) ? formatMoney(row.signed_delta) : `${row.signed_delta > 0 ? "+" : ""}${row.signed_delta}`}</b></div>) : <div className="empty"><Users size={28} /><span>Sélectionnez un joueur.</span></div>}</section></div>;
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

function Metric({ label, value, tone = "" }: { label: string; value: number | string; tone?: string }) { return <article className="metric"><span>{label}</span><strong className={tone}>{typeof value === "number" ? value.toLocaleString("fr-CA") : value}</strong></article>; }
function TableEmpty({ visible }: { visible: boolean }) { return visible ? <div className="empty"><PackageSearch size={28} /><span>Aucune donnée à afficher.</span></div> : null; }
