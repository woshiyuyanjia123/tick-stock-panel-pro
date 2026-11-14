import crypto from 'node:crypto';
import type { StockQuoteItem } from '../../src/types/market';
import { getDb, runInTransaction } from '../db/sqliteDb';
import { fetchAllAShareSnapshots } from '../providers/eastmoney';
import { fetchTencentQuotes, resolveTradingDates } from '../providers/tencent';
import { cleanCode, getBeijingTimeInfo } from '../utils/marketHelpers';
import { fetch28FuturesQuotes, fetchFuturesKLines, FUTURES_28 } from './pandaPmService';
import { getStockDetail } from './stockService';

export interface PaperPortfolioSummary {
  id: string;
  userId: string;
  name: string;
  initialCapital: number;
  cashBalance: number;
  marketValue: number;
  marginUsed: number;
  totalEquity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalReturnPct: number;
  todayPnl: number;
  positionUsagePct: number;
  positionCount: number;
  createdAt: string;
}

export interface PaperPositionItem {
  id: string;
  portfolioId: string;
  symbol: string;
  name: string;
  market: 'ashare' | 'futures';
  side: 'long' | 'short';
  quantity: number;
  availableQuantity: number;
  avgCost: number;
  lastPrice: number;
  leverage: number;
  marginOccupied: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  strategyTag: string;
  openedDate: string;
}

export interface PaperOrderItem {
  id: number;
  portfolioId: string;
  createdAt: string;
  tradingDate: string;
  symbol: string;
  name: string;
  market: 'ashare' | 'futures';
  action: 'buy_long' | 'sell_long' | 'open_short' | 'cover_short';
  quantity: number;
  fillPrice: number;
  leverage: number;
  fee: number;
  realizedPnl: number;
  strategyTag: string;
  note: string;
}

export interface PaperOrderRequest {
  portfolioId?: string;
  symbol: string;
  name?: string;
  market?: 'ashare' | 'futures';
  action: 'buy_long' | 'sell_long' | 'open_short' | 'cover_short';
  quantity?: number;
  capitalAllocationPct?: number;
  price?: number;
  leverage?: number;
  strategyTag?: string;
  note?: string;
}

export interface PaperDeskOverviewResponse {
  updatedAt: string;
  tradingDate: string;
  activePortfolio: PaperPortfolioSummary;
  portfolios: PaperPortfolioSummary[];
  positions: PaperPositionItem[];
  orders: PaperOrderItem[];
  navHistory: {
    timestamp: string;
    totalEquity: number;
    returnPct: number;
    cashBalance: number;
  }[];
}

function nowBj(): string {
  const bj = getBeijingTimeInfo();
  return `${bj.dateStr} ${bj.timeStr}`;
}

function detectMarket(symbol: string, explicit?: 'ashare' | 'futures'): 'ashare' | 'futures' {
  if (explicit === 'ashare' || explicit === 'futures') return explicit;
  const upper = String(symbol || '').trim().toUpperCase().replace(/\..*$/, '');
  if (FUTURES_28.some((m) => m.symbol === upper) || /^[A-Z]{1,3}0$/.test(upper)) {
    return 'futures';
  }
  return 'ashare';
}

function normalizeSymbol(symbol: string, market: 'ashare' | 'futures'): string {
  if (market === 'futures') {
    return String(symbol || '').trim().toUpperCase().replace(/\..*$/, '');
  }
  return cleanCode(symbol);
}

/**
 * Standardized institutional mini-lot multiplier for simulated execution so every one of the 28
 * domestic futures contracts fits comfortably inside a 200k-1M simulation account.
 */
export function getSimFuturesLotMultiplier(symbol: string): number {
  const upper = String(symbol || '').trim().toUpperCase().replace(/\..*$/, '');
  const meta = FUTURES_28.find((m) => m.symbol === upper);
  if (!meta) return 10;
  if (meta.multiplier >= 1000) return Math.round(meta.multiplier / 10);
  if (meta.multiplier >= 200) return Math.round(meta.multiplier / 10);
  return meta.multiplier;
}

async function resolveCurrentTradingDate(): Promise<string> {
  try {
    const d = await resolveTradingDates();
    if (d?.latestDate) return d.latestDate;
  } catch {
    // fallback
  }
  return getBeijingTimeInfo().dateStr;
}

interface ResolvedQuote {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
}

async function resolveBatchQuotes(
  targets: { symbol: string; market: 'ashare' | 'futures' }[]
): Promise<Map<string, ResolvedQuote>> {
  const result = new Map<string, ResolvedQuote>();
  if (targets.length === 0) return result;

  const ashareCodes = Array.from(
    new Set(targets.filter((t) => t.market === 'ashare').map((t) => cleanCode(t.symbol)))
  );
  const futuresSyms = Array.from(
    new Set(targets.filter((t) => t.market === 'futures').map((t) => normalizeSymbol(t.symbol, 'futures')))
  );

  const [snapshots, futuresQuotes] = await Promise.all([
    ashareCodes.length > 0 ? fetchAllAShareSnapshots().catch(() => [] as StockQuoteItem[]) : Promise.resolve([]),
    futuresSyms.length > 0 ? fetch28FuturesQuotes().catch(() => []) : Promise.resolve([]),
  ]);

  if (ashareCodes.length > 0) {
    const snapMap = new Map<string, StockQuoteItem>();
    for (const s of snapshots) {
      snapMap.set(cleanCode(s.code), s);
    }

    const missingCodes: string[] = [];
    for (const c of ashareCodes) {
      const hit = snapMap.get(c);
      if (hit && hit.price > 0) {
        result.set(`ashare:${c}`, {
          symbol: c,
          name: hit.name || c,
          price: hit.price,
          prevClose: hit.prevClose > 0 ? hit.prevClose : hit.price,
        });
      } else {
        missingCodes.push(c);
      }
    }

    if (missingCodes.length > 0) {
      const tq = await fetchTencentQuotes(missingCodes).catch(() => ({} as Record<string, StockQuoteItem>));
      for (const c of missingCodes) {
        const hit = tq[c];
        if (hit && hit.price > 0) {
          result.set(`ashare:${c}`, {
            symbol: c,
            name: hit.name || c,
            price: hit.price,
            prevClose: hit.prevClose > 0 ? hit.prevClose : hit.price,
          });
        }
      }
    }
  }

  if (futuresSyms.length > 0) {
    const futMap = new Map(futuresQuotes.map((f) => [f.symbol.toUpperCase(), f]));
    for (const sym of futuresSyms) {
      const hit = futMap.get(sym);
      if (hit && hit.price > 0) {
        result.set(`futures:${sym}`, {
          symbol: sym,
          name: hit.name || sym,
          price: hit.price,
          prevClose: hit.prevSettle > 0 ? hit.prevSettle : hit.price,
        });
      }
    }
  }

  return result;
}

async function resolveSingleOrderQuote(symbol: string, market: 'ashare' | 'futures'): Promise<ResolvedQuote | null> {
  const norm = normalizeSymbol(symbol, market);
  const batch = await resolveBatchQuotes([{ symbol: norm, market }]);
  const hit = batch.get(`${market}:${norm}`);
  if (hit && hit.price > 0) return hit;

  if (market === 'ashare') {
    try {
      const detail = await getStockDetail(norm, 20);
      if (detail?.quote?.price > 0) {
        return {
          symbol: norm,
          name: detail.name || detail.quote.name || norm,
          price: detail.quote.price,
          prevClose: detail.quote.prevClose || detail.quote.price,
        };
      }
    } catch {
      // ignore
    }
  } else {
    try {
      const k = await fetchFuturesKLines(norm, 10);
      const lastBar = k.klines[k.klines.length - 1];
      const prevBar = k.klines[k.klines.length - 2];
      if (lastBar && lastBar.close > 0) {
        return {
          symbol: norm,
          name: k.name || norm,
          price: lastBar.close,
          prevClose: prevBar?.close || lastBar.open || lastBar.close,
        };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function ensureUserHasPortfolio(userId: string): void {
  const db = getDb();
  const row = db.prepare(`SELECT id FROM paper_portfolios WHERE user_id = ? LIMIT 1`).get(userId);
  if (row) return;
  const pfId = `pf_${crypto.randomBytes(6).toString('hex')}`;
  const ts = nowBj();
  runInTransaction((tx) => {
    tx.prepare(`
      INSERT INTO paper_portfolios (id, user_id, name, initial_capital, cash_balance, realized_pnl, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(pfId, userId, '主策略实盘模拟舱', 1_000_000, 1_000_000, 0, ts);
    tx.prepare(`
      INSERT INTO paper_nav_points (portfolio_id, timestamp, total_equity, return_pct, cash_balance)
      VALUES (?, ?, ?, ?, ?)
    `).run(pfId, ts.slice(0, 16), 1_000_000, 0, 1_000_000);
  });
}

function unlockTPlusOnePositions(portfolioId: string, tradingDate: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE paper_positions
    SET available_quantity = quantity,
        last_unlock_date = ?
    WHERE portfolio_id = ?
      AND market = 'ashare'
      AND last_unlock_date < ?
      AND available_quantity < quantity
  `).run(tradingDate, portfolioId, tradingDate);
}

function computePositionMetrics(
  row: any,
  liveQuote: ResolvedQuote | undefined,
  tradingDate: string
): { item: PaperPositionItem; todayPnlContrib: number; equityContrib: number } {
  const market = row.market as 'ashare' | 'futures';
  const side = row.side as 'long' | 'short';
  const qty = Number(row.quantity);
  const availQty = market === 'futures' ? qty : Number(row.available_quantity);
  const avgCost = Number(row.avg_cost);
  const lastPrice = liveQuote && liveQuote.price > 0 ? liveQuote.price : Number(row.last_price || avgCost);
  const leverage = Number(row.leverage || 1);
  const marginOccupied = Number(row.margin_occupied || 0);
  const mult = market === 'futures' ? getSimFuturesLotMultiplier(row.symbol) : 1;

  const marketValue = Number((qty * lastPrice * mult).toFixed(2));
  const rawPnl =
    side === 'short'
      ? (avgCost - lastPrice) * qty * mult
      : (lastPrice - avgCost) * qty * mult;
  const unrealizedPnl = Number(rawPnl.toFixed(2));
  const basis = market === 'futures' ? Math.max(marginOccupied, 1) : Math.max(avgCost * qty, 1);
  const unrealizedPnlPct = Number(((unrealizedPnl / basis) * 100).toFixed(2));

  let todayPnlContrib = 0;
  if (row.opened_date === tradingDate) {
    todayPnlContrib = unrealizedPnl;
  } else if (liveQuote && liveQuote.prevClose > 0) {
    const dir = side === 'short' ? -1 : 1;
    todayPnlContrib = (lastPrice - liveQuote.prevClose) * qty * mult * dir;
  } else {
    todayPnlContrib = unrealizedPnl * 0.2;
  }

  const equityContrib =
    market === 'ashare' ? marketValue : marginOccupied + unrealizedPnl;

  return {
    item: {
      id: String(row.id),
      portfolioId: String(row.portfolio_id),
      symbol: String(row.symbol),
      name: liveQuote?.name || String(row.name),
      market,
      side,
      quantity: qty,
      availableQuantity: availQty,
      avgCost,
      lastPrice: Number(lastPrice.toFixed(4)),
      leverage,
      marginOccupied: Number(marginOccupied.toFixed(2)),
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      strategyTag: String(row.strategy_tag || '手动下单'),
      openedDate: String(row.opened_date),
    },
    todayPnlContrib,
    equityContrib,
  };
}

function summarizePortfolio(
  pfRow: any,
  posRows: any[],
  quoteMap: Map<string, ResolvedQuote>,
  tradingDate: string
): { summary: PaperPortfolioSummary; positions: PaperPositionItem[] } {
  const initialCapital = Number(pfRow.initial_capital);
  const cashBalance = Number(pfRow.cash_balance);
  const realizedPnl = Number(pfRow.realized_pnl || 0);

  let totalMarketValue = 0;
  let totalMarginUsed = 0;
  let totalUnrealizedPnl = 0;
  let totalTodayPnl = 0;
  let totalEquityContrib = 0;
  const positions: PaperPositionItem[] = [];

  for (const r of posRows) {
    const key = `${r.market}:${r.symbol}`;
    const q = quoteMap.get(key);
    const computed = computePositionMetrics(r, q, tradingDate);
    positions.push(computed.item);
    totalMarketValue += computed.item.marketValue;
    totalMarginUsed += computed.item.marginOccupied;
    totalUnrealizedPnl += computed.item.unrealizedPnl;
    totalTodayPnl += computed.todayPnlContrib;
    totalEquityContrib += computed.equityContrib;
  }

  const totalEquity = Number((cashBalance + totalEquityContrib).toFixed(2));
  const totalReturnPct =
    initialCapital > 0
      ? Number((((totalEquity - initialCapital) / initialCapital) * 100).toFixed(2))
      : 0;
  const deployedCapital = positions.reduce(
    (acc, p) => acc + (p.market === 'ashare' ? p.marketValue : p.marginOccupied),
    0
  );
  const positionUsagePct =
    totalEquity > 0 ? Number(((deployedCapital / totalEquity) * 100).toFixed(2)) : 0;

  return {
    summary: {
      id: String(pfRow.id),
      userId: String(pfRow.user_id),
      name: String(pfRow.name),
      initialCapital: Number(initialCapital.toFixed(2)),
      cashBalance: Number(cashBalance.toFixed(2)),
      marketValue: Number(totalMarketValue.toFixed(2)),
      marginUsed: Number(totalMarginUsed.toFixed(2)),
      totalEquity,
      unrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
      realizedPnl: Number(realizedPnl.toFixed(2)),
      totalReturnPct,
      todayPnl: Number(totalTodayPnl.toFixed(2)),
      positionUsagePct,
      positionCount: positions.length,
      createdAt: String(pfRow.created_at),
    },
    positions,
  };
}

export async function getPaperDeskOverview(
  userId: string,
  portfolioId?: string
): Promise<PaperDeskOverviewResponse> {
  ensureUserHasPortfolio(userId);
  const db = getDb();
  const tradingDate = await resolveCurrentTradingDate();

  const pfRows = db.prepare(`
    SELECT * FROM paper_portfolios
    WHERE user_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(userId) as any[];

  for (const pf of pfRows) {
    unlockTPlusOnePositions(String(pf.id), tradingDate);
  }

  const activePfRow =
    (portfolioId && pfRows.find((p) => p.id === portfolioId)) || pfRows[0];

  const allPosRows = db.prepare(`
    SELECT p.* FROM paper_positions p
    JOIN paper_portfolios pf ON pf.id = p.portfolio_id
    WHERE pf.user_id = ?
  `).all(userId) as any[];

  const quoteTargets = allPosRows.map((p) => ({
    symbol: String(p.symbol),
    market: p.market as 'ashare' | 'futures',
  }));
  const quoteMap = await resolveBatchQuotes(quoteTargets);

  // Persist refreshed last_price quietly for offline resilience
  const updLast = db.prepare(`UPDATE paper_positions SET last_price = ? WHERE id = ?`);
  for (const r of allPosRows) {
    const q = quoteMap.get(`${r.market}:${r.symbol}`);
    if (q && q.price > 0) {
      updLast.run(q.price, r.id);
    }
  }

  const posByPf = new Map<string, any[]>();
  for (const r of allPosRows) {
    const list = posByPf.get(r.portfolio_id) || [];
    list.push(r);
    posByPf.set(r.portfolio_id, list);
  }

  const portfolios: PaperPortfolioSummary[] = [];
  let activePortfolio!: PaperPortfolioSummary;
  let activePositions: PaperPositionItem[] = [];

  for (const pf of pfRows) {
    const res = summarizePortfolio(pf, posByPf.get(pf.id) || [], quoteMap, tradingDate);
    portfolios.push(res.summary);
    if (pf.id === activePfRow.id) {
      activePortfolio = res.summary;
      activePositions = res.positions;
    }
  }

  const orderRows = db.prepare(`
    SELECT * FROM paper_orders
    WHERE portfolio_id = ?
    ORDER BY id DESC
    LIMIT 100
  `).all(activePortfolio.id) as any[];

  const orders: PaperOrderItem[] = orderRows.map((o) => ({
    id: Number(o.id),
    portfolioId: String(o.portfolio_id),
    createdAt: String(o.created_at),
    tradingDate: String(o.trading_date),
    symbol: String(o.symbol),
    name: String(o.name),
    market: o.market as 'ashare' | 'futures',
    action: o.action as PaperOrderItem['action'],
    quantity: Number(o.quantity),
    fillPrice: Number(o.fill_price),
    leverage: Number(o.leverage),
    fee: Number(o.fee),
    realizedPnl: Number(o.realized_pnl),
    strategyTag: String(o.strategy_tag || '手动下单'),
    note: String(o.note || ''),
  }));

  const navRows = db.prepare(`
    SELECT timestamp, total_equity, return_pct, cash_balance
    FROM paper_nav_points
    WHERE portfolio_id = ?
    ORDER BY id ASC
    LIMIT 300
  `).all(activePortfolio.id) as any[];

  const navHistory = navRows.map((n) => ({
    timestamp: String(n.timestamp),
    totalEquity: Number(n.total_equity),
    returnPct: Number(n.return_pct),
    cashBalance: Number(n.cash_balance),
  }));

  return {
    updatedAt: nowBj(),
    tradingDate,
    activePortfolio,
    portfolios,
    positions: activePositions,
    orders,
    navHistory,
  };
}

export async function createPaperPortfolio(
  userId: string,
  payload: { name: string; initialCapital: number }
): Promise<PaperDeskOverviewResponse> {
  const name = String(payload?.name || '').trim().slice(0, 40) || '新建策略模拟组合';
  const initialCapital = Math.max(10_000, Number(payload?.initialCapital || 1_000_000));
  const pfId = `pf_${crypto.randomBytes(6).toString('hex')}`;
  const ts = nowBj();

  runInTransaction((tx) => {
    tx.prepare(`
      INSERT INTO paper_portfolios (id, user_id, name, initial_capital, cash_balance, realized_pnl, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(pfId, userId, name, initialCapital, initialCapital, 0, ts);

    tx.prepare(`
      INSERT INTO paper_nav_points (portfolio_id, timestamp, total_equity, return_pct, cash_balance)
      VALUES (?, ?, ?, ?, ?)
    `).run(pfId, ts.slice(0, 16), initialCapital, 0, initialCapital);
  });

  return getPaperDeskOverview(userId, pfId);
}

export async function resetPaperPortfolio(
  userId: string,
  portfolioId: string
): Promise<PaperDeskOverviewResponse> {
  const db = getDb();
  const pf = db.prepare(`SELECT * FROM paper_portfolios WHERE id = ? AND user_id = ?`).get(portfolioId, userId) as any;
  if (!pf) {
    throw new Error('模拟组合不存在或无权限操作');
  }
  const initialCapital = Number(pf.initial_capital);
  const ts = nowBj();

  runInTransaction((tx) => {
    tx.prepare(`DELETE FROM paper_positions WHERE portfolio_id = ?`).run(portfolioId);
    tx.prepare(`DELETE FROM paper_orders WHERE portfolio_id = ?`).run(portfolioId);
    tx.prepare(`DELETE FROM paper_nav_points WHERE portfolio_id = ?`).run(portfolioId);
    tx.prepare(`UPDATE paper_portfolios SET cash_balance = ?, realized_pnl = 0 WHERE id = ?`).run(
      initialCapital,
      portfolioId
    );
    tx.prepare(`
      INSERT INTO paper_nav_points (portfolio_id, timestamp, total_equity, return_pct, cash_balance)
      VALUES (?, ?, ?, ?, ?)
    `).run(portfolioId, ts.slice(0, 16), initialCapital, 0, initialCapital);
  });

  return getPaperDeskOverview(userId, portfolioId);
}

export async function placePaperOrder(
  userId: string,
  req: PaperOrderRequest
): Promise<PaperDeskOverviewResponse> {
  ensureUserHasPortfolio(userId);
  const db = getDb();
  const tradingDate = await resolveCurrentTradingDate();

  const pfRow = (req.portfolioId
    ? db.prepare(`SELECT * FROM paper_portfolios WHERE id = ? AND user_id = ?`).get(req.portfolioId, userId)
    : db.prepare(`SELECT * FROM paper_portfolios WHERE user_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1`).get(userId)) as any;

  if (!pfRow) {
    throw new Error('目标模拟组合不存在或无权限访问');
  }
  const portfolioId = String(pfRow.id);
  unlockTPlusOnePositions(portfolioId, tradingDate);

  const market = detectMarket(req.symbol, req.market);
  const symbol = normalizeSymbol(req.symbol, market);
  if (!symbol || (market === 'ashare' && symbol.length !== 6)) {
    throw new Error(`无效标的代码: ${req.symbol}`);
  }

  const action = req.action;
  if (!['buy_long', 'sell_long', 'open_short', 'cover_short'].includes(action)) {
    throw new Error(`不支持的交易方向: ${action}`);
  }
  if (market === 'ashare' && (action === 'open_short' || action === 'cover_short')) {
    throw new Error('A股模拟盘严格遵循现货规则，暂不支持融券做空，仅支持买入做多与卖出平多');
  }

  // Resolve fill price
  let liveQuote: ResolvedQuote | null = null;
  if (!(req.price && req.price > 0)) {
    liveQuote = await resolveSingleOrderQuote(symbol, market);
  }
  const existingPosAny = db.prepare(`
    SELECT * FROM paper_positions WHERE portfolio_id = ? AND symbol = ? AND market = ? LIMIT 1
  `).get(portfolioId, symbol, market) as any;

  const fillPrice =
    req.price && req.price > 0
      ? Number(req.price)
      : liveQuote && liveQuote.price > 0
        ? liveQuote.price
        : existingPosAny && existingPosAny.last_price > 0
          ? Number(existingPosAny.last_price)
          : 0;

  if (!(fillPrice > 0)) {
    throw new Error(`无法获取 ${symbol} 实时成交价，请稍后重试或手动输入委托价格`);
  }

  const displayName =
    String(req.name || '').trim() ||
    liveQuote?.name ||
    existingPosAny?.name ||
    FUTURES_28.find((f) => f.symbol === symbol)?.name ||
    symbol;

  const leverage =
    market === 'ashare' ? 1 : Math.min(10, Math.max(1, Number(req.leverage || 5)));
  const mult = market === 'futures' ? getSimFuturesLotMultiplier(symbol) : 1;
  const strategyTag = String(req.strategyTag || '手动下单').trim() || '手动下单';
  const note = String(req.note || '').trim();
  const createdAt = nowBj();

  // Compute order quantity (either explicit or via capitalAllocationPct)
  let qty = Number(req.quantity || 0);
  if (!(qty > 0) && req.capitalAllocationPct && req.capitalAllocationPct > 0) {
    const pct = Math.min(95, Math.max(1, Number(req.capitalAllocationPct)));
    const budget = Number(pfRow.cash_balance) * (pct / 100);
    if (market === 'ashare') {
      qty = Math.floor(budget / fillPrice / 100) * 100;
      if (qty < 100 && Number(pfRow.cash_balance) >= fillPrice * 100 * 1.001) {
        qty = 100;
      }
    } else {
      const marginPerLot = (fillPrice * mult) / leverage;
      qty = Math.max(1, Math.floor(budget / Math.max(marginPerLot, 1)));
    }
  }

  if (market === 'ashare') {
    if (action === 'buy_long') {
      qty = Math.floor(qty / 100) * 100;
      if (qty < 100) {
        throw new Error('A股买入数量须至少为 100 股 (1手) 且按100股整数倍下单');
      }
    } else {
      qty = Math.floor(qty);
      if (qty <= 0) throw new Error('卖出数量必须大于 0');
    }
  } else {
    qty = Math.floor(qty);
    if (qty <= 0) throw new Error('期货委托手数必须为正整数');
  }

  runInTransaction((tx) => {
    const pf = tx.prepare(`SELECT * FROM paper_portfolios WHERE id = ?`).get(portfolioId) as any;
    let cashBalance = Number(pf.cash_balance);
    let pfRealizedPnl = Number(pf.realized_pnl || 0);
    let orderFee = 0;
    let orderRealizedPnl = 0;
    let execNote = note;

    if (market === 'ashare') {
      if (action === 'buy_long') {
        const notional = fillPrice * qty;
        orderFee = Number(Math.max(5, notional * 0.00025).toFixed(2));
        const totalCost = notional + orderFee;
        if (cashBalance < totalCost) {
          throw new Error(
            `可用现金不足：需要 ¥${totalCost.toFixed(2)}，当前可用 ¥${cashBalance.toFixed(2)}`
          );
        }
        cashBalance = Number((cashBalance - totalCost).toFixed(2));

        const pos = tx.prepare(`
          SELECT * FROM paper_positions
          WHERE portfolio_id = ? AND symbol = ? AND market = 'ashare' AND side = 'long'
        `).get(portfolioId, symbol) as any;

        if (pos) {
          const prevQty = Number(pos.quantity);
          const newQty = prevQty + qty;
          const newAvg = (Number(pos.avg_cost) * prevQty + notional) / newQty;
          // Preserve existing unlocked available_quantity; new shares remain T+1 locked until next trading day
          tx.prepare(`
            UPDATE paper_positions
            SET name = ?, quantity = ?, avg_cost = ?, last_price = ?, strategy_tag = ?, opened_date = ?, last_unlock_date = ?
            WHERE id = ?
          `).run(
            displayName,
            newQty,
            Number(newAvg.toFixed(4)),
            fillPrice,
            strategyTag,
            tradingDate,
            tradingDate,
            pos.id
          );
        } else {
          tx.prepare(`
            INSERT INTO paper_positions
              (id, portfolio_id, symbol, name, market, side, quantity, available_quantity, avg_cost, last_price, leverage, margin_occupied, strategy_tag, opened_date, last_unlock_date)
            VALUES (?, ?, ?, ?, 'ashare', 'long', ?, 0, ?, ?, 1, 0, ?, ?, ?)
          `).run(
            `pos_${crypto.randomBytes(6).toString('hex')}`,
            portfolioId,
            symbol,
            displayName,
            qty,
            Number(fillPrice.toFixed(4)),
            fillPrice,
            strategyTag,
            tradingDate,
            tradingDate
          );
        }
        if (!execNote) {
          execNote = `A股T+1买入${qty}股（当日锁仓，次一交易日自动解锁可卖）`;
        }
      } else {
        // sell_long
        const pos = tx.prepare(`
          SELECT * FROM paper_positions
          WHERE portfolio_id = ? AND symbol = ? AND market = 'ashare' AND side = 'long'
        `).get(portfolioId, symbol) as any;

        if (!pos || Number(pos.quantity) <= 0) {
          throw new Error(`无 ${symbol} 多头持仓可平仓`);
        }
        const avail = Number(pos.available_quantity);
        if (qty > avail) {
          throw new Error(
            `触发A股T+1风控锁仓拦截：${symbol}(${displayName}) 今日买入仓位需次一交易日解锁（当前可卖 ${avail} 股，总持仓 ${pos.quantity} 股）`
          );
        }
        const proceeds = fillPrice * qty;
        const commission = Math.max(5, proceeds * 0.00025);
        const stampDuty = proceeds * 0.0005;
        orderFee = Number((commission + stampDuty).toFixed(2));
        orderRealizedPnl = Number(((fillPrice - Number(pos.avg_cost)) * qty - orderFee).toFixed(2));

        cashBalance = Number((cashBalance + proceeds - orderFee).toFixed(2));
        pfRealizedPnl = Number((pfRealizedPnl + orderRealizedPnl).toFixed(2));

        const remQty = Number(pos.quantity) - qty;
        const remAvail = avail - qty;
        if (remQty <= 0) {
          tx.prepare(`DELETE FROM paper_positions WHERE id = ?`).run(pos.id);
        } else {
          tx.prepare(`
            UPDATE paper_positions
            SET quantity = ?, available_quantity = ?, last_price = ?
            WHERE id = ?
          `).run(remQty, remAvail, fillPrice, pos.id);
        }
        if (!execNote) {
          execNote = `A股卖出平多${qty}股（含佣金+印花税 ¥${orderFee.toFixed(2)}）`;
        }
      }
    } else {
      // Domestic Futures T+0 Bidirectional Leveraged Margin
      const isOpening = action === 'buy_long' || action === 'open_short';
      const targetSide: 'long' | 'short' =
        action === 'buy_long' || action === 'sell_long' ? 'long' : 'short';

      if (isOpening) {
        const notional = fillPrice * qty * mult;
        const marginReq = Number((notional / leverage).toFixed(2));
        orderFee = Number(Math.max(2, notional * 0.0001).toFixed(2));
        const cashReq = marginReq + orderFee;
        if (cashBalance < cashReq) {
          throw new Error(
            `可用保证金不足：需保证金+手续费 ¥${cashReq.toFixed(2)}，当前可用 ¥${cashBalance.toFixed(2)}`
          );
        }
        cashBalance = Number((cashBalance - cashReq).toFixed(2));

        const pos = tx.prepare(`
          SELECT * FROM paper_positions
          WHERE portfolio_id = ? AND symbol = ? AND market = 'futures' AND side = ?
        `).get(portfolioId, symbol, targetSide) as any;

        if (pos) {
          const prevQty = Number(pos.quantity);
          const newQty = prevQty + qty;
          const newAvg = (Number(pos.avg_cost) * prevQty + fillPrice * qty) / newQty;
          const newMargin = Number(pos.margin_occupied) + marginReq;
          tx.prepare(`
            UPDATE paper_positions
            SET name = ?, quantity = ?, available_quantity = ?, avg_cost = ?, last_price = ?, leverage = ?, margin_occupied = ?, strategy_tag = ?
            WHERE id = ?
          `).run(
            displayName,
            newQty,
            newQty,
            Number(newAvg.toFixed(4)),
            fillPrice,
            leverage,
            Number(newMargin.toFixed(2)),
            strategyTag,
            pos.id
          );
        } else {
          tx.prepare(`
            INSERT INTO paper_positions
              (id, portfolio_id, symbol, name, market, side, quantity, available_quantity, avg_cost, last_price, leverage, margin_occupied, strategy_tag, opened_date, last_unlock_date)
            VALUES (?, ?, ?, ?, 'futures', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            `pos_${crypto.randomBytes(6).toString('hex')}`,
            portfolioId,
            symbol,
            displayName,
            targetSide,
            qty,
            qty,
            Number(fillPrice.toFixed(4)),
            fillPrice,
            leverage,
            marginReq,
            strategyTag,
            tradingDate,
            tradingDate
          );
        }
        if (!execNote) {
          execNote = `期货T+0 ${leverage}x ${targetSide === 'long' ? '开多' : '开空'} ${qty}手 (每手乘数${mult})`;
        }
      } else {
        // Closing long (sell_long) or covering short (cover_short) — immediate T+0 allowed
        const pos = tx.prepare(`
          SELECT * FROM paper_positions
          WHERE portfolio_id = ? AND symbol = ? AND market = 'futures' AND side = ?
        `).get(portfolioId, symbol, targetSide) as any;

        if (!pos || Number(pos.quantity) <= 0) {
          throw new Error(
            `无 ${symbol} ${targetSide === 'long' ? '多头' : '空头'}持仓可平仓`
          );
        }
        const curQty = Number(pos.quantity);
        if (qty > curQty) {
          throw new Error(`平仓手数(${qty})超过当前持仓(${curQty})`);
        }
        const notional = fillPrice * qty * mult;
        orderFee = Number(Math.max(2, notional * 0.0001).toFixed(2));
        const releasedMargin = Number(pos.margin_occupied) * (qty / curQty);
        const priceDiff =
          targetSide === 'long'
            ? fillPrice - Number(pos.avg_cost)
            : Number(pos.avg_cost) - fillPrice;
        orderRealizedPnl = Number((priceDiff * qty * mult - orderFee).toFixed(2));

        cashBalance = Number((cashBalance + releasedMargin + orderRealizedPnl).toFixed(2));
        pfRealizedPnl = Number((pfRealizedPnl + orderRealizedPnl).toFixed(2));

        const remQty = curQty - qty;
        const remMargin = Number(pos.margin_occupied) - releasedMargin;
        if (remQty <= 0) {
          tx.prepare(`DELETE FROM paper_positions WHERE id = ?`).run(pos.id);
        } else {
          tx.prepare(`
            UPDATE paper_positions
            SET quantity = ?, available_quantity = ?, margin_occupied = ?, last_price = ?
            WHERE id = ?
          `).run(remQty, remQty, Number(remMargin.toFixed(2)), fillPrice, pos.id);
        }
        if (!execNote) {
          execNote = `期货T+0 ${targetSide === 'long' ? '平多' : '买入平空'} ${qty}手 (实现盈亏 ¥${orderRealizedPnl.toFixed(2)})`;
        }
      }
    }

    tx.prepare(`UPDATE paper_portfolios SET cash_balance = ?, realized_pnl = ? WHERE id = ?`).run(
      cashBalance,
      pfRealizedPnl,
      portfolioId
    );

    tx.prepare(`
      INSERT INTO paper_orders
        (portfolio_id, created_at, trading_date, symbol, name, market, action, quantity, fill_price, leverage, fee, realized_pnl, strategy_tag, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      portfolioId,
      createdAt,
      tradingDate,
      symbol,
      displayName,
      market,
      action,
      qty,
      Number(fillPrice.toFixed(4)),
      leverage,
      orderFee,
      orderRealizedPnl,
      strategyTag,
      execNote
    );

    // Record updated NAV snapshot immediately after execution
    const remainingPos = tx.prepare(`SELECT * FROM paper_positions WHERE portfolio_id = ?`).all(portfolioId) as any[];
    let equitySum = cashBalance;
    for (const p of remainingPos) {
      const m = p.market === 'futures' ? getSimFuturesLotMultiplier(p.symbol) : 1;
      const lp = Number(p.last_price || p.avg_cost);
      const q = Number(p.quantity);
      if (p.market === 'ashare') {
        equitySum += lp * q;
      } else {
        const upnl = (p.side === 'short' ? Number(p.avg_cost) - lp : lp - Number(p.avg_cost)) * q * m;
        equitySum += Number(p.margin_occupied) + upnl;
      }
    }
    const initCap = Number(pf.initial_capital);
    const retPct = initCap > 0 ? Number((((equitySum - initCap) / initCap) * 100).toFixed(2)) : 0;
    tx.prepare(`
      INSERT INTO paper_nav_points (portfolio_id, timestamp, total_equity, return_pct, cash_balance)
      VALUES (?, ?, ?, ?, ?)
    `).run(portfolioId, createdAt.slice(0, 16), Number(equitySum.toFixed(2)), retPct, cashBalance);
  });

  return getPaperDeskOverview(userId, portfolioId);
}

export async function closePaperPosition(
  userId: string,
  positionId: string
): Promise<PaperDeskOverviewResponse> {
  const db = getDb();
  const row = db.prepare(`
    SELECT p.*, pf.user_id
    FROM paper_positions p
    JOIN paper_portfolios pf ON pf.id = p.portfolio_id
    WHERE p.id = ? AND pf.user_id = ?
  `).get(positionId, userId) as any;

  if (!row) {
    throw new Error('未找到目标持仓记录或无权平仓');
  }

  return placePaperOrder(userId, {
    portfolioId: String(row.portfolio_id),
    symbol: String(row.symbol),
    name: String(row.name),
    market: row.market as 'ashare' | 'futures',
    action: row.side === 'short' ? 'cover_short' : 'sell_long',
    quantity: Number(row.quantity),
    leverage: Number(row.leverage || 1),
    strategyTag: String(row.strategy_tag || '一键平仓'),
    note: '持仓面板一键市价全平',
  });
}

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportPaperOrdersCsv(userId: string, portfolioId?: string): string {
  const db = getDb();
  const rows = (portfolioId
    ? db.prepare(`
        SELECT o.*, pf.name AS portfolio_name
        FROM paper_orders o
        JOIN paper_portfolios pf ON pf.id = o.portfolio_id
        WHERE pf.user_id = ? AND o.portfolio_id = ?
        ORDER BY o.id DESC
      `).all(userId, portfolioId)
    : db.prepare(`
        SELECT o.*, pf.name AS portfolio_name
        FROM paper_orders o
        JOIN paper_portfolios pf ON pf.id = o.portfolio_id
        WHERE pf.user_id = ?
        ORDER BY o.id DESC
      `).all(userId)) as any[];

  const actionLabel: Record<string, string> = {
    buy_long: '买入做多',
    sell_long: '卖出平多',
    open_short: '开仓做空',
    cover_short: '买入平空',
  };

  const header = [
    '订单ID',
    '成交时间',
    '交易日',
    '组合名称',
    '代码',
    '名称',
    '市场',
    '方向',
    '成交价',
    '数量',
    '杠杆',
    '手续费',
    '实现盈亏',
    '策略来源',
    '备注',
  ].join(',');

  const lines = rows.map((r) =>
    [
      r.id,
      r.created_at,
      r.trading_date,
      r.portfolio_name,
      r.symbol,
      r.name,
      r.market === 'futures' ? '国内期货T+0' : 'A股T+1',
      actionLabel[r.action] || r.action,
      r.fill_price,
      r.quantity,
      `${r.leverage}x`,
      r.fee,
      r.realized_pnl,
      r.strategy_tag,
      r.note,
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return `\uFEFF${header}\n${lines.join('\n')}`;
}

export function getActivePortfolioQuickSummary(userId = 'u_desk_admin'): {
  portfolioName: string;
  totalEquity: number;
  totalReturnPct: number;
  unrealizedPnl: number;
} | null {
  try {
    const db = getDb();
    const pf = db.prepare(`
      SELECT * FROM paper_portfolios
      WHERE user_id = ?
      ORDER BY created_at ASC, rowid ASC
      LIMIT 1
    `).get(userId) as any;
    if (!pf) return null;

    const posRows = db.prepare(`SELECT * FROM paper_positions WHERE portfolio_id = ?`).all(pf.id) as any[];
    let equity = Number(pf.cash_balance);
    let unrealizedPnl = 0;
    for (const p of posRows) {
      const m = p.market === 'futures' ? getSimFuturesLotMultiplier(p.symbol) : 1;
      const lp = Number(p.last_price || p.avg_cost);
      const q = Number(p.quantity);
      const upnl = (p.side === 'short' ? Number(p.avg_cost) - lp : lp - Number(p.avg_cost)) * q * m;
      unrealizedPnl += upnl;
      equity += p.market === 'ashare' ? lp * q : Number(p.margin_occupied) + upnl;
    }
    const initCap = Number(pf.initial_capital || 1);
    const totalReturnPct = initCap > 0 ? Number((((equity - initCap) / initCap) * 100).toFixed(2)) : 0;
    return {
      portfolioName: String(pf.name),
      totalEquity: Number(equity.toFixed(2)),
      totalReturnPct,
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
    };
  } catch {
    return null;
  }
}
