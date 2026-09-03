import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { A, useNavigate } from "@solidjs/router";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui/Button";
import { CreateTableDialog } from "../components/CreateTableDialog";
import { FeedbackDialog } from "../components/FeedbackDialog";
import { MOCK_MODE, apiBase, apiKey, deleteTable, listTables } from "../lib/api";
import { supabase } from "../lib/supabase";
import { blinds, money } from "../lib/money";
import type { TableSummary } from "../lib/types";
import type { LobbyTableWire } from "../lib/protocol";
import { TableSocket, lobbyWsUrl } from "../lib/ws";
import { cn } from "../lib/cn";

// Seat pip hues — rotate the Notion accent cast (DESIGN.md)
const PIP_HUES = ["bg-sky-wash", "bg-marigold", "bg-coral", "bg-accent", "bg-midnight"];

const toSummary = (w: LobbyTableWire): TableSummary => ({
  id: w.id,
  name: w.name,
  gameType: w.game_type === "PLO4" ? "PLO4" : "NLHE",
  smallBlindCents: w.small_blind,
  bigBlindCents: w.big_blind,
  seatsFilled: w.seated,
  maxSeats: w.max_seats,
  createdBy: w.created_by ?? null,
});

export function LobbyPage() {
  // Never let the fetcher reject — a rejected resource leaves the lobby
  // pending forever under the router; a result object always settles.
  const [tables, { refetch }] = createResource(async () => {
    try {
      return { ok: true as const, rows: await listTables() };
    } catch (e) {
      return { ok: false as const, err: e instanceof Error ? e.message : String(e) };
    }
  });
  const navigate = useNavigate();
  const failed = () => !tables.loading && tables.latest != null && !tables.latest.ok;

  // Live lobby feed: the server pushes the full list whenever it changes
  // (seat/join/leave, create, delete). reconcile by id keeps unchanged
  // TableCards mounted so only the changed bits re-render (seat pips
  // animate). The 5s resource poll below continues ONLY while the feed is
  // down (fly cold start, proxy drop) — the WS snapshot on reconnect
  // supersedes anything the poll fetched.
  const [live, setLive] = createStore<{ rows: TableSummary[] }>({ rows: [] });
  const [feedOpen, setFeedOpen] = createSignal(false);
  const rows = (): TableSummary[] =>
    feedOpen() ? live.rows : tables.latest?.ok ? tables.latest.rows : [];

  onMount(() => {
    if (MOCK_MODE) return;
    const sock = new TableSocket(
      lobbyWsUrl(apiBase, apiKey),
      "", // lobby feed is public — no token
      (m) => {
        if (m.type === "lobby") {
          setLive("rows", reconcile(m.lobby.map(toSummary), { key: "id" }));
          setFeedOpen(true);
        }
      },
      (s) => {
        // feedOpen flips on only when a snapshot arrives (below) so an open
        // socket with no snapshot yet falls back to resource rows instead
        // of flashing "No tables yet"
        if (s !== "open") setFeedOpen(false);
      },
    );
    void sock.connect();
    onCleanup(() => sock.close());
  });

  // auth state for the nav (ASPTR-193e): sign out when a supabase session exists
  const [authed, setAuthed] = createSignal(false);
  const [email, setEmail] = createSignal("");
  const [uid, setUid] = createSignal("");
  onMount(async () => {
    const sb = supabase();
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    setAuthed(!!data.session);
    setEmail(data.session?.user.email ?? "");
    setUid(data.session?.user.id ?? "");
  });
  const signOut = async () => {
    await supabase()?.auth.signOut();
    setAuthed(false);
  };

  // live seat counts: poll only while the feed is down (visible tab)
  let poll: number | undefined;
  onMount(() => {
    poll = window.setInterval(() => {
      if (!feedOpen() && !tables.loading) void refetch();
    }, 5000);
  });
  onCleanup(() => window.clearInterval(poll));

  const onDelete = async (t: TableSummary) => {
    if (!window.confirm(`Delete table “${t.name}”? Everyone is removed immediately.`)) return;
    try {
      await deleteTable(t.id);
      // instant removal; the live feed reconciles the authoritative list ≤2s
      setLive("rows", (rs) => rs.filter((r) => r.id !== t.id));
      void refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const onJoin = async (t: TableSummary) => {
    navigate(`/table/${t.id}${location.search}`);
  };

  return (
    <div class="flex min-h-dvh flex-col bg-bg">
      <header class="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md shadow-[0px_0.7px_1.462px_0px_rgb(0_0_0/0.015),0px_3px_9px_0px_rgb(0_0_0/0.03)]">
        <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <A href="/" class="flex items-center gap-2.5">
            <span class="grid size-8 place-items-center rounded-btn bg-accent-tint text-accent">
              <Logo class="size-5" />
            </span>
            <span class="font-display text-base font-bold tracking-tight text-fg">River Rats</span>
          </A>
          <div class="flex items-center gap-3">
            <Show when={MOCK_MODE}>
              <span class="hidden rounded-pill border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-fg-muted sm:inline">
                mock data
              </span>
            </Show>
            <Show when={authed()}>
              <span
                class="hidden max-w-44 truncate rounded-pill border border-line bg-surface px-2.5 py-0.5 text-xs text-fg-muted sm:inline"
                title={email()}
              >
                {email()}
              </span>
              <Button variant="text" size="sm" onClick={signOut}>
                Sign out
              </Button>
            </Show>
            <Show when={!authed()}>
              <A href="/auth">
                <Button variant="outline" size="sm">
                  Sign in
                </Button>
              </A>
            </Show>
          </div>
        </div>
      </header>

      <main class="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-16 sm:px-6">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 class="font-display text-2xl font-bold tracking-tight text-fg sm:text-3xl">
              Tables
            </h1>
            <p class="mt-1 text-sm text-fg-muted">
              <Show
                when={rows().length ? rows() : undefined}
                fallback={failed() ? "Tables unavailable" : "Loading tables…"}
              >
                {(rws) => (
                  <>
                    {rws().length} live
                    <Show when={MOCK_MODE}> · demo lobby, backend not configured</Show>
                  </>
                )}
              </Show>
            </p>
          </div>
          <CreateTableDialog
            onCreated={(t) => {
              // instant appearance; the live feed reconciles the list ≤2s
              setLive("rows", (rs) => (rs.some((r) => r.id === t.id) ? rs : [...rs, t]));
              void refetch();
            }}
          />
        </div>

        <Show when={failed()}>
          <div class="mt-10 flex flex-col items-center gap-3 rounded-card border border-danger/30 bg-surface px-6 py-12 text-center">
            <p class="font-medium text-fg">Couldn't load tables</p>
            <p class="text-sm text-fg-muted">
              {tables.latest && !tables.latest.ok ? tables.latest.err : ""}
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Show>

        {/* stale-while-revalidate: rows() falls back to the resource while
            the live feed is down, and latest holds last settled rows during
            a poll refetch — keep the grid mounted instead of flashing the
            skeleton; skeleton only on the initial load. */}
        <Show
          when={!failed() && rows().length}
          fallback={
            <Show when={!failed()} fallback={null}>
              <Show when={tables.latest != null} fallback={<TableSkeleton />}>
                <div class="mt-10 grid place-items-center rounded-card border border-dashed border-black/15 bg-surface px-6 py-16 text-center">
                  <p class="font-medium text-fg">No tables yet</p>
                  <p class="mt-1 text-sm text-fg-muted">
                    Deal yourself in — create the first table.
                  </p>
                </div>
              </Show>
            </Show>
          }
        >
          <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <For each={rows()}>
              {(t) => (
                <TableCard
                  table={t}
                  canDelete={authed() && !!t.createdBy && t.createdBy === uid()}
                  onDelete={() => void onDelete(t)}
                  onJoin={() => onJoin(t)}
                />
              )}
            </For>
          </div>
        </Show>
      </main>

      {/* feedback (ASPTR-192) */}
      <footer class="flex justify-center border-t border-line/60 py-3">
        <FeedbackDialog />
      </footer>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div data-i={i} class="h-44 animate-pulse rounded-card border border-line bg-surface" />
      ))}
    </div>
  );
}

function TableCard(props: {
  table: TableSummary;
  canDelete: boolean;
  onDelete: () => void;
  onJoin: () => void;
}) {
  const t = () => props.table;
  const full = () => t().seatsFilled >= t().maxSeats;
  // invite link: copies this table's URL to the clipboard
  const [copied, setCopied] = createSignal(false);
  const share = () => {
    const u = new URL(`/table/${t().id}`, window.location.origin);
    navigator.clipboard.writeText(u.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <article class="group flex flex-col rounded-card border border-line bg-surface p-5 transition-[border-color] duration-200 ease-out hover:border-black/20">
      <div class="flex items-start justify-between gap-3">
        <h2 class="font-display text-base font-semibold leading-tight text-fg">{t().name}</h2>
        <span
          class={cn(
            "flex-none rounded-pill px-2 py-0.5 text-[11px] font-semibold tracking-wide",
            t().gameType === "PLO4" ? "bg-marigold text-black" : "bg-surface-raised text-fg-muted",
          )}
        >
          {t().gameType}
        </span>
      </div>

      <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div class="flex flex-col">
          <dt class="text-xs text-fg-muted">Blinds</dt>
          <dd class="font-medium tabular-nums text-fg">
            {blinds(t().smallBlindCents, t().bigBlindCents)}
          </dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-xs text-fg-muted">Avg pot</dt>
          <dd class="font-medium tabular-nums text-fg">
            {t().avgPotCents != null ? money(t().avgPotCents!) : "—"}
          </dd>
        </div>
      </dl>

      <div
        class="mt-4 flex items-center gap-1.5"
        role="img"
        aria-label={`${t().seatsFilled} of ${t().maxSeats} seats taken`}
      >
        <For each={Array.from({ length: t().maxSeats })}>
          {(_, i) => (
            <span
              class={cn(
                "h-1.5 flex-1 rounded-pill transition-colors duration-200",
                i() < t().seatsFilled ? PIP_HUES[i() % PIP_HUES.length] : "bg-black/10",
              )}
            />
          )}
        </For>
      </div>

      <div class="mt-5 flex items-center justify-between gap-2">
        <span class="text-sm tabular-nums text-fg-muted">
          {t().seatsFilled}/{t().maxSeats} seated
        </span>
        <div class="flex items-center gap-2">
          <Show when={props.canDelete}>
            <button
              type="button"
              title="Delete table"
              aria-label="Delete table"
              class="grid size-8 place-items-center rounded-btn border border-line text-fg-muted transition-colors hover:border-danger/40 hover:text-danger"
              onClick={props.onDelete}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="size-4"
                aria-hidden="true"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </Show>
          <button
            type="button"
            title={copied() ? "Link copied!" : "Copy invite link"}
            aria-label="Copy invite link"
            class="grid size-8 place-items-center rounded-btn border border-line text-fg-muted transition-colors hover:border-black/20 hover:text-fg"
            onClick={share}
          >
            <Show
              when={copied()}
              fallback={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  class="size-4"
                  aria-hidden="true"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              }
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="size-4 text-accent"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </Show>
          </button>
          <Show when={!full()} fallback={<span class="text-sm font-medium text-danger">Full</span>}>
            <Button size="sm" variant="default" onClick={props.onJoin}>
              Join
            </Button>
          </Show>
        </div>
      </div>
    </article>
  );
}
