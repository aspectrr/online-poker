import { createSignal, onCleanup } from "solid-js";
import { TableSocket, tableWsUrl } from "../lib/ws";
import { authIdentity, rememberGuestName } from "../lib/identity";
import {
  actionLabel,
  cardText,
  toUICard,
  uiCards,
  uiLegal,
  uiSeat,
  type ConnectionStatus,
  type GameEvent,
  type LegalActionsWire,
  type PlayerAction,
  type SeatWire,
  type ServerMsg,
  type TableSnapshot,
  type TableState,
  type TableStore,
  type WireCard,
} from "../lib/protocol";
import { money } from "../lib/money";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/** Dealer-chip travel time; dealing waits for it when the button moves. */
export const BUTTON_TRAVEL_MS = 700;

const emptySeat = (seat: number): TableState["seats"][number] => ({
  seat,
  player: "",
  stackCents: 0,
  sittingOut: false,
  inHand: false,
  folded: false,
  betCents: 0,
  hasCards: false,
});

const defaultCfg = (): TableState["cfg"] => ({
  actionTimeoutS: 15,
  interHandDelayS: 10,
  rit: "never",
  rabbitHunt: false,
  sevenDeuce: false,
  sevenDeuceBounty: 0,
  bombPotMode: "off",
  bombPotTriggers: [],
  texasDropAnte: 0,
});

function initialState(tableId: string): TableState {
  return {
    tableId,
    name: "table",
    gameType: "NLHE",
    sbCents: 0,
    bbCents: 0,
    seats: Array.from({ length: 6 }, (_, i) => emptySeat(i)),
    maxSeats: 6,
    heroSeat: -1,
    buttonSeat: -1,
    landingSeat: -1,
    street: "preflop",
    potCents: 0,
    board: { street: "preflop", boards: [[]] },
    holeCards: [],
    heroHand: "",
    toAct: -1,
    deadlineUnixMs: null,
    rebuysUsed: 0,
    topUpQueued: false,
    turnTimeoutMs: 20000,
    legal: null,
    handNo: 0,
    message: "connecting…",
    bombPot: false,
    texasDrop: false,
    dropPhase: null,
    texasDropArmed: false,
    banner: null,
    equities: null,
    boardWinTexts: [],
    isDoubleBoard: false,
    postHand: null,
    cfg: defaultCfg(),
    bombPotArmed: null,
    boardWins: [],
    dealt: [],
    dealTotal: 2,
    dealDone: true,
  };
}

/**
 * Live table store (ASPTR-199): ws -> TableStore facade. Joins the first
 * open seat on mount when we have an identity; spectator (heroSeat -1)
 * otherwise. Engine events fold into seats / board / pot / turn state.
 */
const mergeSeatView = (s: TableState) => (w: SeatWire) => {
  const prev = s.seats.find((x) => x.seat === w.seat);
  // preserve client-only overlays: the frame trails the event batch, so
  // pot_awarded's winner flag would otherwise be wiped instantly
  return { ...uiSeat(w), revealedCards: prev?.revealedCards, isWinner: prev?.isWinner };
};

function createTableStore(tableId: string): TableStore {
  const [state, setState] = createSignal<TableState>(initialState(tableId));
  const [status, setStatus] = createSignal<ConnectionStatus>("connecting");
  const [lastError, setLastError] = createSignal<string | null>(null);
  const [toasts, setToasts] = createSignal<
    { id: number; text: string; kind?: "gold" | "rabbit" }[]
  >([]);

  let sock: TableSocket | null = null;
  let me: { name: string; isGuest: boolean } | null = null;
  let toastId = 0;
  let dealTimers: ReturnType<typeof setTimeout>[] = [];
  let boardTimers: ReturnType<typeof setTimeout>[] = [];
  let bannerTimer: ReturnType<typeof setTimeout>;
  let pendingDevDeal: WireCard[] | null = null; // ?deal= param → sent on next hand start

  const patch = (p: Partial<TableState>) => setState((s) => ({ ...s, ...p }));

  const toast = (text: string, kind?: "gold" | "rabbit") => {
    const id = ++toastId;
    setToasts((ts) => [...ts, { id, text, kind }]);
    setTimeout(
      () => setToasts((ts) => ts.filter((t) => t.id !== id)),
      kind === "gold" ? 6000 : 4500,
    );
  };

  const clearDealTimers = () => {
    dealTimers.forEach(clearTimeout);
    dealTimers = [];
    boardTimers.forEach(clearTimeout);
    boardTimers = [];
  };

  /** Felt banner with a 5s auto-dismiss — persistent banners covered the
   *  top seat's cards. */
  const showBanner = (kind: string | null) => {
    clearTimeout(bannerTimer);
    patch({ banner: kind });
    if (kind) {
      bannerTimer = setTimeout(() => patch({ banner: null }), 5000);
    }
  };

  /**
   * Opening-deal choreography: dealer button glides to its new seat, then
   * one card per seated player clockwise from left of the button, round by
   * round. per-card 170ms, 260ms pause between rounds. When the button
   * moved, dealing waits for the button travel (BUTTON_TRAVEL_MS).
   */
  const scheduleDeal = (s: TableState, bombPot: boolean, buttonMoved = false) => {
    clearDealTimers();
    const rounds = bombPot ? 4 : 2;
    const n = s.seats.length;
    // inHand flags can be stale here (seats frame trails the event batch);
    // the engine deals in every occupied, non-sitting-out, stacked seat.
    const inHand: number[] = [];
    for (let i = 1; i <= n; i++) {
      const seat = (s.buttonSeat + i) % n;
      const x = s.seats[seat];
      if (x && x.player && x.stackCents > 0 && !x.sittingOut) inHand.push(seat);
    }
    if (inHand.length === 0) return;
    const perCard = 170;
    const roundGap = 260;
    let t = buttonMoved ? BUTTON_TRAVEL_MS : 0;
    for (let r = 0; r < rounds; r++) {
      for (const seat of inHand) {
        dealTimers.push(
          setTimeout(() => {
            setState((cur) => {
              const d = [...cur.dealt];
              d[seat] = (d[seat] ?? 0) + 1;
              return { ...cur, dealt: d };
            });
          }, t),
        );
        t += perCard;
      }
      t += roundGap;
    }
    dealTimers.push(
      setTimeout(() => {
        patch({ dealDone: true });
        // action "lands" on first-to-act (UTG) once the last card is out
        const utg = state().toAct;
        if (utg >= 0) {
          patch({ landingSeat: utg });
          dealTimers.push(
            setTimeout(() => {
              if (state().landingSeat === utg) patch({ landingSeat: -1 });
            }, 1400),
          );
        }
      }, t),
    );
  };

  const reduce = (m: ServerMsg) => {
    switch (m.type) {
      case "state":
        applySnapshot(m.state);
        break;
      case "seats":
        setState((s) => ({ ...s, seats: m.seats.map(mergeSeatView(s)) }));
        break;
      case "event":
        applyEvent(m.event);
        break;
      case "action_required":
        setState((s) => {
          const hero = s.heroSeat >= 0 && m.legal.seat === s.heroSeat;
          return {
            ...s,
            toAct: m.legal.seat,
            legal: hero ? uiLegal(m.legal as LegalActionsWire) : s.legal,
            postHand: hero ? null : s.postHand,
          };
        });
        break;
      case "post_hand":
        setState((s) => ({
          ...s,
          postHand:
            m.post.seat === s.heroSeat
              ? { bounty: m.post.bounty, rabbit: m.post.rabbit, reveal: m.post.reveal }
              : null,
          toAct: -1,
          legal: null,
          deadlineUnixMs: null,
          rebuysUsed: 0,
          topUpQueued: false,
        }));
        break;
      case "error":
        setLastError(m.error);
        setTimeout(() => setLastError((e) => (e === m.error ? null : e)), 4000);
        break;
    }
  };

  /** Merge a wire seats frame into current view, preserving overlays. */
  const applySnapshot = (snap: TableSnapshot) => {
    setState((s) => {
      const inHand = snap.hand_in_progress;
      const legal =
        snap.legal_actions && snap.legal_actions.seat === snap.your_seat
          ? uiLegal(snap.legal_actions)
          : null;
      const c = snap.config;
      const cfg: TableState["cfg"] = {
        actionTimeoutS: c.action_timeout_s,
        interHandDelayS: c.inter_hand_delay_s ?? 10,
        rit: c.rit ?? "never",
        rabbitHunt: c.rabbit_hunt ?? false,
        sevenDeuce: c.seven_deuce ?? false,
        sevenDeuceBounty: c.seven_deuce_bounty ?? 0,
        bombPotMode: c.bomb_pot_mode ?? "off",
        bombPotTriggers: c.bomb_pot_triggers ?? [],
        texasDropAnte: c.texas_drop_ante ?? 0,
      };
      const rounds = snap.bomb_pot ? 4 : 2;
      const heroSeatWire = snap.seats.find((x) => x.seat === snap.your_seat);
      const dropPhase =
        snap.texas_drop && snap.drop_round
          ? {
              round: snap.drop_round,
              waiting: snap.drop_waiting ?? 0,
              heroDecided: snap.drop_decided ?? false,
              heroEligible: !!heroSeatWire?.in_hand && !heroSeatWire?.folded,
            }
          : null;
      return {
        ...s,
        name: snap.name,
        gameType: snap.config.game_type === "PLO4" ? "PLO4" : "NLHE",
        sbCents: snap.config.small_blind,
        bbCents: snap.config.big_blind,
        maxSeats: Math.max(2, snap.config.max_seats),
        heroSeat: snap.your_seat,
        buttonSeat: snap.seats.find((x) => x.is_button)?.seat ?? -1,
        handNo: snap.hand_no,
        street: (snap.street as TableState["street"]) ?? (inHand ? "preflop" : s.street),
        potCents: snap.pot ?? 0,
        board: { ...s.board, boards: (snap.board?.length ? snap.board : [[]]).map(uiCards) },
        isDoubleBoard: (snap.board?.length ?? 1) > 1,
        holeCards: snap.your_cards?.length ? [uiCards(snap.your_cards)] : inHand ? s.holeCards : [],
        heroHand: inHand ? (snap.your_hand ?? "") : "",
        toAct: snap.to_act_seat ?? -1,
        deadlineUnixMs: snap.deadline_unix_ms || null,
        rebuysUsed: snap.rebuys_used ?? 0,
        topUpQueued: !!snap.top_up_queued,
        landingSeat: -1,
        turnTimeoutMs: Math.max(1000, (snap.config.action_timeout_s || 20) * 1000),
        legal,
        message: inHand ? s.message : "Waiting for players…",
        cfg,
        // reconnect into a live hand keeps the bomb-pot banner; a fresh seat loses it
        bombPot: snap.bomb_pot ?? false,
        bombPotArmed: snap.bomb_pot_next ? (s.bombPotArmed ?? true) : null,
        texasDrop: snap.texas_drop ?? false,
        texasDropArmed: !!snap.texas_drop_next,
        dropPhase,
        boardWins: inHand ? s.boardWins : [],
        // reconnect mid-hand: skip the deal animation, everything's landed
        dealt:
          inHand && s.dealDone === false
            ? s.dealt
            : Array.from({ length: s.seats.length }, () => rounds),
        dealTotal: rounds,
        dealDone: true,
        postHand: null,
        seats: snap.seats.map((w) => {
          const prev = s.seats.find((x) => x.seat === w.seat);
          return { ...uiSeat(w), revealedCards: inHand ? prev?.revealedCards : undefined };
        }),
      };
    });
  };

  const applyEvent = (e: GameEvent) => {
    // seat 0 / board 0 are omitted by Go's omitempty — coerce with ?? 0
    const seat = e.seat ?? 0;
    const boardIdx = e.board_index ?? 0;
    switch (e.type) {
      case "hand_started": {
        const bombPot = e.bomb_pot ?? false;
        const texasDrop = e.texas_drop ?? false;
        const prevButton = state().buttonSeat;
        const btn = e.button_seat;
        const buttonMoved = btn != null && btn !== prevButton;
        setState((s) => ({
          ...s,
          handNo: e.hand_id || s.handNo + 1,
          bombPot,
          texasDrop,
          texasDropArmed: false,
          dropPhase: null,
          equities: null,
          boardWinTexts: [],
          isDoubleBoard: bombPot,
          street: "preflop",
          potCents: 0,
          board: { street: "preflop", boards: [[]] },
          holeCards: [],
          heroHand: "",
          toAct: -1,
          deadlineUnixMs: null,
          rebuysUsed: 0,
          topUpQueued: false,
          legal: null,
          postHand: null,
          bombPotArmed: null,
          boardWins: [],
          landingSeat: -1,
          buttonSeat: btn ?? s.buttonSeat,
          dealTotal: bombPot ? 4 : 2,
          dealt: Array.from({ length: s.seats.length }, () => 0),
          dealDone: false,
          message: bombPot
            ? "Bomb pot — 4 cards, antes in"
            : texasDrop
              ? "Texas Drop — antes in, board incoming"
              : `Hand #${e.hand_id || s.handNo + 1}`,
          seats: s.seats.map((x) => ({
            ...x,
            // seats frame trails the event batch; mirror the server's
            // dealt-in rule now so drop_decide + turn UI see fresh flags
            inHand: !!x.player && x.stackCents > 0 && !x.sittingOut,
            hasCards: !!x.player && x.stackCents > 0 && !x.sittingOut,
            folded: false,
            lastAction: undefined,
            isWinner: false,
            revealedCards: undefined,
          })),
        }));
        showBanner(bombPot ? "bomb" : texasDrop ? "drop" : null);
        scheduleDeal(state(), bombPot, buttonMoved);
        // hidden dev flag: force hero hole cards (server honors only in dev builds)
        if (pendingDevDeal && state().heroSeat >= 0) {
          sock?.send({ type: "dev_deal", seat: state().heroSeat, cards: pendingDevDeal });
        }
        break;
      }
      case "holes_dealt":
        if (seat === state().heroSeat) {
          setState((s) => ({ ...s, holeCards: [uiCards(e.cards)] }));
        }
        break;
      case "bomb_pot_armed":
        patch({ bombPotArmed: e.cards?.length ? toUICard(e.cards[0]) : true });
        showBanner("bomb_armed");
        break;
      case "texas_drop_armed":
        // drop supersedes an armed bomb pot (server consumes it too)
        patch({ texasDropArmed: true, bombPotArmed: null });
        showBanner("drop_armed");
        break;
      case "drop_decide":
        showBanner("drop");
        setState((s) => {
          const hero = s.seats[s.heroSeat];
          return {
            ...s,
            street: "drop" as TableState["street"],
            dropPhase: {
              round: e.round ?? 1,
              waiting: e.waiting ?? 0,
              heroDecided: false,
              heroEligible: !!hero?.inHand && !hero?.folded,
            },
            toAct: -1,
            deadlineUnixMs: null,
            rebuysUsed: 0,
            topUpQueued: false,
            legal: null,
            message:
              (e.round ?? 1) > 1
                ? `Texas Drop — round ${e.round}, board is out`
                : "Board is out — stay or drop?",
          };
        });
        break;
      case "drop_decided":
        // private ack — only the decider receives it
        setState((s) =>
          seat === s.heroSeat && s.dropPhase
            ? {
                ...s,
                dropPhase: {
                  ...s.dropPhase,
                  heroDecided: true,
                  waiting: Math.max(0, s.dropPhase.waiting - 1),
                },
              }
            : s,
        );
        break;
      case "drop_reveal":
        setState((s) => ({
          ...s,
          dropPhase: s.dropPhase ? { ...s.dropPhase, waiting: 0 } : null,
          potCents: e.pot ?? s.potCents,
          message: "Decisions in",
          seats: s.seats.map((x) => {
            const d = e.decisions?.find((y) => y.seat === x.seat);
            return d
              ? {
                  ...x,
                  lastAction: d.stay ? "Stay" : "Drop",
                  folded: x.folded || !d.stay,
                }
              : x;
          }),
        }));
        break;
      case "drop_replenish":
        setState((s) => ({
          ...s,
          potCents: e.pot ?? s.potCents,
          message: `${e.player ?? "seat " + seat} re-ups the pot${e.amount ? ` (${money(e.amount)})` : ""}`,
          seats: s.seats.map((x) => (x.seat === seat ? { ...x, betCents: e.amount ?? 0 } : x)),
        }));
        break;
      case "blinds_posted":
      case "antes_posted":
        // stacks/bets come from the seats frame that follows this batch;
        // just label the seat.
        setState((s) => ({
          ...s,
          seats: s.seats.map((x) =>
            x.seat === seat
              ? {
                  ...x,
                  lastAction:
                    e.type === "blinds_posted"
                      ? actionLabel(e.amount === s.sbCents ? "sb" : "bb", 0)
                      : "Ante",
                }
              : x,
          ),
        }));
        break;
      case "street_dealt": {
        // Drop rounds emit flop+turn+river in one batch — apply them
        // staggered so the board deals like a normal hand instead of five
        // cards flying at once (the pile-up). Guarded by handNo so stale
        // timers can't patch a newer hand; snapshots always override.
        const handNo = state().handNo;
        const applyStreet = () =>
          setState((s) => {
            if (s.handNo !== handNo) return s;
            const boards = s.board.boards.length ? [...s.board.boards] : [[]];
            while (boards.length <= boardIdx) boards.push([]);
            const isFlop = e.street === "flop";
            boards[boardIdx] = isFlop
              ? uiCards(e.cards)
              : [...boards[boardIdx], ...uiCards(e.cards)];
            const label = boards.length > 1 ? ` (board ${String.fromCharCode(65 + boardIdx)})` : "";
            return {
              ...s,
              // drop_decide (same batch) may already be open — don't clobber
              // the drop street label with the delayed flop/turn/river patch
              street: s.street === "drop" ? s.street : (e.street as TableState["street"]),
              board: { ...s.board, boards },
              isDoubleBoard: boards.length > 1,
              potCents: e.pot ?? s.potCents,
              message: `${e.street}: ${cardText(e.cards)}${label}`,
              seats: s.seats.map((x) => ({ ...x, betCents: 0 })), // swept into the pot
            };
          });
        if (state().texasDrop) {
          const delay = e.street === "flop" ? 600 : e.street === "turn" ? 950 : 1300;
          boardTimers.push(setTimeout(applyStreet, delay));
        } else {
          applyStreet();
        }
        break;
      }
      case "action_accepted":
        setState((s) => {
          const kind = e.action?.kind;
          const label =
            kind === "raise" && (e.to ?? 0) > 0
              ? `Raise to ${money(e.to!)}`
              : kind === "call" && (e.amount ?? 0) > 0
                ? `Call ${money(e.amount!)}`
                : kind
                  ? actionLabel(kind, 0)
                  : "";
          return {
            ...s,
            // turn moved on: nobody is on the clock until the next turn_changed
            toAct: -1,
            deadlineUnixMs: null,
            rebuysUsed: 0,
            topUpQueued: false,
            legal: seat === s.heroSeat ? null : s.legal,
            seats: s.seats.map((x) =>
              x.seat === seat
                ? { ...x, lastAction: label, folded: kind === "fold" || x.folded }
                : x,
            ),
          };
        });
        break;
      case "turn_changed": {
        const dl = e.deadline_unix_ms || 0;
        setState((s) => ({
          ...s,
          toAct: e.to_act ?? 0,
          deadlineUnixMs: dl || null,
          turnTimeoutMs: dl ? Math.min(120000, Math.max(1000, dl - Date.now())) : s.turnTimeoutMs,
          potCents: e.pot ?? s.potCents,
          legal: null, // action_required follows for the hero
        }));
        break;
      }
      case "all_in_runout": {
        const eq: Record<number, number> = {};
        for (const x of e.equities ?? []) eq[x.seat] = x.pct;
        patch({
          message: e.board_index === 1 ? "All-in — running it twice" : "All-in — running it out",
          equities: Object.keys(eq).length ? eq : null,
        });
        break;
      }
      case "showdown":
        setState((s) => ({
          ...s,
          street: "showdown",
          message: "Showdown",
          potCents: e.pot ?? s.potCents,
          seats: s.seats.map((x) => {
            const reveal = e.hole_cards?.find((h) => h.seat === x.seat);
            return reveal ? { ...x, revealedCards: uiCards(reveal.cards) } : x;
          }),
        }));
        break;
      case "pot_awarded": {
        setState((s) => {
          const w = e.winners ?? [];
          const first = w[0];
          const winBoardIdx = first?.board_index ?? 0;
          const boardLabel = s.isDoubleBoard
            ? ` ${s.bombPot ? "board " + String.fromCharCode(65 + winBoardIdx) : "run " + (winBoardIdx + 1)}`
            : "";
          const names = [
            ...new Set(w.map((y) => s.seats[y.seat]?.player ?? "seat " + y.seat)),
          ].join(" + ");
          const line = `${names} wins ${money(w.reduce((a, x) => a + (x.amount ?? 0), 0))}${first?.hand_name ? ` — ${first.hand_name.replace(/_/g, " ")}` : ""}`;
          // double board: one winner line per board so both stay visible
          let boardWinTexts = s.boardWinTexts;
          let message = first ? line : s.message;
          if (s.isDoubleBoard) {
            boardWinTexts = [...(s.boardWinTexts ?? [])];
            boardWinTexts[winBoardIdx] = `${line} (${boardLabel.trim()})`;
            message = boardWinTexts.filter(Boolean).join("  ·  ");
          }
          return {
            ...s,
            message,
            potCents: e.round ? 0 : s.potCents, // drop game: pot just got taken
            boardWinTexts,
            seats: s.seats.map((x) =>
              w.some((y) => y.seat === x.seat) ? { ...x, isWinner: true } : x,
            ),
            boardWins:
              s.isDoubleBoard && !s.boardWins.includes(winBoardIdx)
                ? [...s.boardWins, winBoardIdx]
                : s.boardWins,
          };
        });
        break;
      }
      case "hole_reveal": {
        setState((s) => ({
          ...s,
          seats: s.seats.map((x) => {
            const r = (e.hole_cards ?? []).find((h) => h.seat === x.seat);
            return r ? { ...x, revealedCards: uiCards(r.cards) } : x;
          }),
        }));
        break;
      }
      case "seven_deuce_bounty":
        toast(`${e.player ?? "someone"} wins ${money(e.amount ?? 0)} bounty w/ 7-2!`, "gold");
        break;
      case "rabbit_hunt": {
        const rabbitCards = uiCards(e.rabbit).map((c) => ({ ...c, rabbit: true as const }));
        setState((s) => {
          const boards = s.board.boards.length ? [...s.board.boards] : [[]];
          boards[0] = [...boards[0], ...rabbitCards];
          return {
            ...s,
            message: `Rabbit hunt: ${cardText(e.rabbit)}`,
            board: { ...s.board, boards },
          };
        });
        toast(`Rabbit hunt: ${cardText(e.rabbit)}`, "rabbit");
        break;
      }
      case "hand_ended":
        setState((s) => ({
          ...s,
          street: "complete",
          toAct: -1,
          deadlineUnixMs: null,
          rebuysUsed: 0,
          topUpQueued: false,
          legal: null,
          dropPhase: null,
          equities: null,
          seats: s.seats.map((x) => {
            const fs = e.stacks?.find((y) => y.seat === x.seat);
            return fs ? { ...x, stackCents: fs.stack, betCents: 0 } : { ...x, betCents: 0 };
          }),
        }));
        break;
    }
  };

  let retryTimer: number | null = null;
  const connect = async () => {
    if (!API_URL) {
      patch({ message: "no API configured" });
      setStatus("closed");
      return;
    }
    const id = await authIdentity().catch(() => null);
    if (!id) {
      // server unreachable (e.g. cold start): retry instead of stranding the
      // player on "connecting" until a manual refresh
      patch({ message: "couldn't reach the server — retrying…" });
      setStatus("closed");
      if (retryTimer === null) {
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          void connect();
        }, 4000);
      }
      return;
    }
    me = { name: id.name, isGuest: id.isGuest };
    // token resolved per attempt so reconnects pick up fresh identities
    sock = new TableSocket(
      tableWsUrl(API_URL, tableId, import.meta.env.VITE_API_KEY as string | undefined),
      async () => (await authIdentity().catch(() => null))?.token,
      reduce,
      setStatus,
    );
    sock.connect();
  };

  // Idle dormancy: an abandoned tab holding a WS open keeps the fly machine
  // awake forever (open connection = no auto-stop). After 30min without any
  // user input, close the socket and stop reconnecting; the first pointer /
  // key / focus / visible event reconnects (seat re-adopts by token).
  const idleTTL = 30 * 60 * 1000;
  let dormant = false;
  let lastActivity = Date.now();
  const wake = () => {
    lastActivity = Date.now();
    if (dormant) {
      dormant = false;
      patch({ message: "" });
      void connect();
    }
  };
  const activityEvents: [string, EventListener][] = [
    ["pointerdown", wake],
    ["keydown", wake],
    ["focus", wake],
    [
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") wake();
      },
    ],
  ];
  for (const [name, fn] of activityEvents) window.addEventListener(name, fn);
  const idleCheck = window.setInterval(() => {
    if (!dormant && Date.now() - lastActivity > idleTTL) {
      dormant = true;
      patch({ message: "asleep — tap to reconnect" });
      sock?.close(); // no reconnect: TableSocket.closed stops the loop
    }
  }, 60 * 1000);
  onCleanup(() => {
    window.clearInterval(idleCheck);
    for (const [name, fn] of activityEvents) window.removeEventListener(name, fn);
  });
  const send = (a: PlayerAction) => {
    if (a.kind === "raise") sock?.send({ type: "action", kind: "bet", amount: a.toCents });
    else if (a.kind === "reveal") sock?.send({ type: "rabbit", reveal: true });
    else if (a.kind === "muck") sock?.send({ type: "rabbit", reveal: false });
    else if (a.kind === "rabbit") sock?.send({ type: "rabbit" });
    else sock?.send({ type: "action", kind: a.kind });
  };

  const joinSeat = (seat: number, guestName?: string, stackCents?: number) => {
    if (guestName && me?.isGuest) {
      me = { ...me, name: guestName };
      rememberGuestName(guestName);
    }
    sock?.send({ type: "join", seat, name: me?.name, stack: stackCents });
  };

  const armBombPot = () => {
    sock?.send({ type: "bomb_pot" });
  };

  const topUp = () => {
    sock?.send({ type: "top_up" });
  };
  const armTexasDrop = () => {
    sock?.send({ type: "texas_drop" });
  };

  const devDeal = (cards: WireCard[]) => {
    pendingDevDeal = cards.length ? cards : null;
    // already in a hand between deal + hand_started? apply to next hand
  };

  onCleanup(() => {
    clearDealTimers();
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    sock?.close();
  });

  void connect(); // fire-and-forget: resolves identity, opens the socket

  return {
    get state() {
      return state();
    },
    send,
    joinSeat,
    armBombPot,
    armTexasDrop,
    topUp,
    devDeal,
    get me() {
      return me;
    },
    get status() {
      return status();
    },
    get lastError() {
      return lastError();
    },
    get toasts() {
      return toasts();
    },
    dispose: () => sock?.close(),
  };
}

/** Parse a `?deal=` param like "7d2d" / "AsKs" into wire cards; null if invalid. */
export function parseDealParam(s: string | undefined): WireCard[] | null {
  if (!s) return null;
  const RANKS = "23456789TJQKA";
  const SUITS = "shdc";
  const out: WireCard[] = [];
  for (let i = 0; i + 1 < s.length; i += 2) {
    const r = RANKS.indexOf(s[i].toUpperCase());
    const u = SUITS.indexOf(s[i + 1].toLowerCase());
    if (r < 0 || u < 0) return null;
    out.push(r * 4 + u);
  }
  return out.length ? out : null;
}

export function provideTable(tableId: string, dealParam?: string): TableStore {
  const store = createTableStore(tableId);
  const forced = parseDealParam(dealParam);
  if (forced) {
    // route through the store's dev hook: set via devDeal before connect ran is
    // not possible (async), so hand the cards to the first hand_started instead.
    store.devDeal(forced);
  }
  return store;
}
