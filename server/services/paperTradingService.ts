import crypto from 'node:crypto';
import type {
  AlertTriggerEvent,
  AssetFactBuyPointProfile,
  OmsExecutionPolicy,
  OmsOrderBookLevel,
  OmsQuotePreviewResponse,
  PaperDeskOverviewResponse,
  PaperOrderItem,
  PaperOrderRequest,
  PaperPortfolioSummary,
  PaperPositionItem,
  StockQuoteItem,
} from '../../src/types/market';
import {
  dbGetOmsPolicy,
  getDb,
  runInTransaction,
} from '../db/sqliteDb';
import { fetchAllAShareSnapshots } from '../providers/eastmoney';
import { fetchTencentQuotes, resolveTradingDates } from '../providers/tencent';
import { fetchGbkTextWithRetry } from '../utils/httpCache';
import { cleanCode, getBeijingTimeInfo, toTencentSymbol } from '../utils/marketHelpers';
import { fetch28FuturesQuotes, fetchFuturesKLines, FUTURES_28 } from './pandaPmService';
import { getStockDetail } from './stockService';

export type {
  OmsExecutionPolicy,
  OmsOrderBookLevel,
  OmsQuotePreviewResponse,
  PaperDeskOverviewResponse,
  PaperOrderItem,
  PaperOrderRequest,
  PaperPortfolioSummary,
  PaperPositionItem,
};

const TENCENT_HEADERS = {
  Referer: 'https://gu.qq.com/',
};

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
 * Standardized institutional mini-lot multiplier for domestic futures sizing
 * so every one of the 28 contracts scales accurately within multi-strategy desk accounts.
 */
export function getSimFuturesLotMultiplier(symbol: string): number {
  const upper = String(symbol || '').trim().toUpperCase().replace(/\..*$/, '');
  const meta = FUTURES_28.find((m) => m.symbol === upper);
  if (!meta) return 10;
  if (meta.multiplier >= 1000) return Math.round(meta.multiplier / 10);
  if (meta.multiplier >= 200) return Math.round(meta.multiplier / 10);
  return meta.multiplier;
}

const FUTURES_TICK_MAP: Record<string, number> = {
  AU0: 0.02,
  AG0: 1,
  SC0: 0.1,
  EC0: 0.1,
  CU0: 10,
  AL0: 5,
  ZN0: 5,
  NI0: 10,
  SN0: 10,
  TL0: 0.01,
  T0: 0.005,
  IF0: 0.2,
  IH0: 0.2,
  IC0: 0.2,
  IM0: 0.2,
  LC0: 50,
  SI0: 5,
  RB0: 1,
  FG0: 1,
  I0: 0.5,
  MA0: 1,
  TA0: 2,
  M0: 1,
  P0: 2,
  FU0: 1,
  BU0: 2,
  RU0: 5,
  SP0: 2,
};

export function getInstrumentTickSize(symbol: string, market: 'ashare' | 'futures'): number {
  if (market === 'ashare') return 0.01;
  const upper = normalizeSymbol(symbol, 'futures');
  return FUTURES_TICK_MAP[upper] ?? 1;
}

function roundToTick(price: number, tick: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const safeTick = tick > 0 ? tick : 0.01;
  const rounded = Math.round(price / safeTick) * safeTick;
  const decimals = safeTick < 0.01 ? 3 : safeTick < 1 ? 2 : 0;
  return Number(rounded.toFixed(decimals));
}

function buildSyntheticDepth(
  midPrice: number,
  tick: number,
  baseLots: number
): { bids: OmsOrderBookLevel[]; asks: OmsOrderBookLevel[] } {
  const bids: OmsOrderBookLevel[] = [];
  const asks: OmsOrderBookLevel[] = [];
  for (let i = 1; i <= 5; i++) {
    bids.push({
      level: i,
      price: roundToTick(Math.max(tick, midPrice - i * tick), tick),
      volume: Math.max(1, Math.round(baseLots * (1.2 + i * 0.45))),
    });
    asks.push({
      level: i,
      price: roundToTick(midPrice + i * tick, tick),
      volume: Math.max(1, Math.round(baseLots * (1.1 + i * 0.4))),
    });
  }
  return { bids, asks };
}

export async function getOmsQuotePreview(
  rawSymbol: string,
  explicitMarket?: 'ashare' | 'futures'
): Promise<OmsQuotePreviewResponse> {
  const market = detectMarket(rawSymbol, explicitMarket);
  const symbol = normalizeSymbol(rawSymbol, market);
  if (!symbol || (market === 'ashare' && symbol.length !== 6)) {
    throw new Error(`无效交易代码: ${rawSymbol}`);
  }
  const tick = getInstrumentTickSize(symbol, market);

  if (market === 'ashare') {
    const tSym = toTencentSymbol(symbol);
    let parsed: string[] | null = null;
    try {
      const text = await fetchGbkTextWithRetry(`https://qt.gtimg.cn/q=${tSym}`, TENCENT_HEADERS, 6000, 1);
      const eq = text.indexOf('=');
      if (eq >= 0) {
        parsed = text
          .slice(eq + 1)
          .replace(/^"|"[\s;]*$/g, '')
          .split('~');
      }
    } catch {
      parsed = null;
    }

    if (parsed && parsed.length >= 36 && Number(parsed[3] || 0) > 0) {
      const lastPrice = Number(parsed[3]);
      const prevClose = Number(parsed[4] || lastPrice);
      const changePct =
        Number(parsed[32] || 0) ||
        (prevClose > 0 ? Number((((lastPrice - prevClose) / prevClose) * 100).toFixed(2)) : 0);
      const upperLimit = Number(parsed[47] || 0) || Number((prevClose * 1.1).toFixed(2));
      const lowerLimit = Number(parsed[48] || 0) || Number((prevClose * 0.9).toFixed(2));

      const rawBids: OmsOrderBookLevel[] = [
        { level: 1, price: Number(parsed[9] || 0), volume: Math.round(Number(parsed[10] || 0)) },
        { level: 2, price: Number(parsed[11] || 0), volume: Math.round(Number(parsed[12] || 0)) },
        { level: 3, price: Number(parsed[13] || 0), volume: Math.round(Number(parsed[14] || 0)) },
        { level: 4, price: Number(parsed[15] || 0), volume: Math.round(Number(parsed[16] || 0)) },
        { level: 5, price: Number(parsed[17] || 0), volume: Math.round(Number(parsed[18] || 0)) },
      ].filter((b) => b.price > 0);

      const rawAsks: OmsOrderBookLevel[] = [
        { level: 1, price: Number(parsed[19] || 0), volume: Math.round(Number(parsed[20] || 0)) },
        { level: 2, price: Number(parsed[21] || 0), volume: Math.round(Number(parsed[22] || 0)) },
        { level: 3, price: Number(parsed[23] || 0), volume: Math.round(Number(parsed[24] || 0)) },
        { level: 4, price: Number(parsed[25] || 0), volume: Math.round(Number(parsed[26] || 0)) },
        { level: 5, price: Number(parsed[27] || 0), volume: Math.round(Number(parsed[28] || 0)) },
      ].filter((a) => a.price > 0);

      const fallbackDepth = buildSyntheticDepth(lastPrice, tick, 85);
      return {
        symbol,
        name: String(parsed[1] || symbol).trim(),
        market: 'ashare',
        lastPrice,
        prevClose,
        changePct,
        upperLimit,
        lowerLimit,
        lotSize: 100,
        multiplier: 1,
        tickSize: tick,
        estSlippageBps: 1.5,
        commissionRate: 0.00025,
        stampDutyRate: 0.0005,
        transferFeeRate: 0.00001,
        bids: rawBids.length >= 3 ? rawBids : fallbackDepth.bids,
        asks: rawAsks.length >= 3 ? rawAsks : fallbackDepth.asks,
        updatedAt: nowBj(),
      };
    }

    const q = await resolveSingleOrderQuote(symbol, 'ashare');
    if (!q || !(q.price > 0)) {
      throw new Error(`暂无 ${symbol} 盘口报价数据`);
    }
    const depth = buildSyntheticDepth(q.price, tick, 60);
    return {
      symbol,
      name: q.name,
      market: 'ashare',
      lastPrice: q.price,
      prevClose: q.prevClose,
      changePct: q.prevClose > 0 ? Number((((q.price - q.prevClose) / q.prevClose) * 100).toFixed(2)) : 0,
      upperLimit: Number((q.prevClose * 1.1).toFixed(2)),
      lowerLimit: Number((q.prevClose * 0.9).toFixed(2)),
      lotSize: 100,
      multiplier: 1,
      tickSize: tick,
      estSlippageBps: 1.5,
      commissionRate: 0.00025,
      stampDutyRate: 0.0005,
      transferFeeRate: 0.00001,
      bids: depth.bids,
      asks: depth.asks,
      updatedAt: nowBj(),
    };
  }

  // Domestic Futures
  const q = await resolveSingleOrderQuote(symbol, 'futures');
  if (!q || !(q.price > 0)) {
    throw new Error(`暂未拉取到期货 ${symbol} 实时报价`);
  }
  const depth = buildSyntheticDepth(q.price, tick, 24);
  return {
    symbol,
    name: q.name,
    market: 'futures',
    lastPrice: q.price,
    prevClose: q.prevClose,
    changePct: q.prevClose > 0 ? Number((((q.price - q.prevClose) / q.prevClose) * 100).toFixed(2)) : 0,
    upperLimit: roundToTick(q.prevClose * 1.07, tick),
    lowerLimit: roundToTick(q.prevClose * 0.93, tick),
    lotSize: 1,
    multiplier: getSimFuturesLotMultiplier(symbol),
    tickSize: tick,
    estSlippageBps: 1.0,
    commissionRate: 0.0001,
    stampDutyRate: 0,
    transferFeeRate: 0,
    bids: depth.bids,
    asks: depth.asks,
    updatedAt: nowBj(),
  };
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
    `).run(pfId, userId, '旗舰主策略实盘专户', 1_000_000, 1_000_000, 0, ts);
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

  const stopLossPrice =
    row.stop_loss_price !== null && row.stop_loss_price !== undefined && Number(row.stop_loss_price) > 0
      ? Number(row.stop_loss_price)
      : null;
  const takeProfitPrice =
    row.take_profit_price !== null && row.take_profit_price !== undefined && Number(row.take_profit_price) > 0
      ? Number(row.take_profit_price)
      : null;

  let distanceToStopPct: number | null = null;
  if (stopLossPrice && lastPrice > 0) {
    distanceToStopPct = Number(
      (
        side === 'short'
          ? ((stopLossPrice - lastPrice) / lastPrice) * 100
          : ((lastPrice - stopLossPrice) / lastPrice) * 100
      ).toFixed(2)
    );
  }

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
      stopLossPrice,
      takeProfitPrice,
      distanceToStopPct,
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
    execId: String(o.exec_id || `EX-${String(o.id).padStart(6, '0')}`),
    orderType: (o.order_type || 'MARKET_IOC') as PaperOrderItem['orderType'],
    slippageBps: Number(o.slippage_bps ?? 1.2),
    taxAndFeeDetail: String(o.tax_and_fee_detail || ''),
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
    policy: dbGetOmsPolicy(userId),
    navHistory,
  };
}

export async function createPaperPortfolio(
  userId: string,
  payload: { name: string; initialCapital: number }
): Promise<PaperDeskOverviewResponse> {
  const name = String(payload?.name || '').trim().slice(0, 40) || '新建策略实盘专户';
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
    throw new Error('实盘专户不存在或无权限操作');
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
    throw new Error('目标实盘专户不存在或无权限访问');
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
    throw new Error('A股现货账户严格遵循交易所规则，不支持裸卖空，请通过股指/商品期货席位建立空头对冲');
  }

  // Resolve fill price & OMS execution metadata
  const orderType: NonNullable<PaperOrderRequest['orderType']> =
    req.orderType || (req.price && req.price > 0 ? 'LIMIT' : 'MARKET_IOC');
  const tickSize = getInstrumentTickSize(symbol, market);
  const requestedSlippage =
    req.slippageBps !== undefined
      ? Math.max(0, Math.min(30, Number(req.slippageBps)))
      : req.price && req.price > 0
        ? 0
        : market === 'ashare'
          ? 1.5
          : 1.0;

  let liveQuote: ResolvedQuote | null = null;
  if (!(req.price && req.price > 0)) {
    liveQuote = await resolveSingleOrderQuote(symbol, market);
  }
  const existingPosAny = db.prepare(`
    SELECT * FROM paper_positions WHERE portfolio_id = ? AND symbol = ? AND market = ? LIMIT 1
  `).get(portfolioId, symbol, market) as any;

  const basePrice =
    req.price && req.price > 0
      ? Number(req.price)
      : liveQuote && liveQuote.price > 0
        ? liveQuote.price
        : existingPosAny && existingPosAny.last_price > 0
          ? Number(existingPosAny.last_price)
          : 0;

  if (!(basePrice > 0)) {
    throw new Error(`无法获取 ${symbol} 实时成交价，请稍后重试或手动输入委托限价`);
  }

  const isBuyFlow = action === 'buy_long' || action === 'cover_short';
  const slippedRaw =
    requestedSlippage > 0
      ? basePrice * (1 + (isBuyFlow ? 1 : -1) * (requestedSlippage / 10_000))
      : basePrice;
  const fillPrice = roundToTick(slippedRaw, tickSize) || Number(basePrice.toFixed(4));
  const execId = `EX${tradingDate.replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const defaultStopLoss =
    action === 'open_short'
      ? roundToTick(fillPrice * 1.045, tickSize)
      : roundToTick(fillPrice * 0.955, tickSize);
  const stopLossPrice =
    req.stopLossPrice !== undefined && req.stopLossPrice !== null && Number(req.stopLossPrice) > 0
      ? roundToTick(Number(req.stopLossPrice), tickSize)
      : defaultStopLoss;
  const takeProfitPrice =
    req.takeProfitPrice !== undefined && req.takeProfitPrice !== null && Number(req.takeProfitPrice) > 0
      ? roundToTick(Number(req.takeProfitPrice), tickSize)
      : null;

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
    let taxAndFeeDetail = '';

    if (market === 'ashare') {
      if (action === 'buy_long') {
        const notional = fillPrice * qty;
        const comm = Number(Math.max(5, notional * 0.00025).toFixed(2));
        const xfer = Number((notional * 0.00001).toFixed(2));
        orderFee = Number((comm + xfer).toFixed(2));
        taxAndFeeDetail = `佣金¥${comm.toFixed(2)} + 过户费¥${xfer.toFixed(2)}`;
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
            SET name = ?, quantity = ?, avg_cost = ?, last_price = ?, strategy_tag = ?, opened_date = ?, last_unlock_date = ?,
                stop_loss_price = COALESCE(?, stop_loss_price), take_profit_price = COALESCE(?, take_profit_price)
            WHERE id = ?
          `).run(
            displayName,
            newQty,
            Number(newAvg.toFixed(4)),
            fillPrice,
            strategyTag,
            tradingDate,
            tradingDate,
            req.stopLossPrice && req.stopLossPrice > 0 ? stopLossPrice : null,
            takeProfitPrice,
            pos.id
          );
        } else {
          tx.prepare(`
            INSERT INTO paper_positions
              (id, portfolio_id, symbol, name, market, side, quantity, available_quantity, avg_cost, last_price, leverage, margin_occupied, strategy_tag, opened_date, last_unlock_date, stop_loss_price, take_profit_price)
            VALUES (?, ?, ?, ?, 'ashare', 'long', ?, 0, ?, ?, 1, 0, ?, ?, ?, ?, ?)
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
            tradingDate,
            stopLossPrice,
            takeProfitPrice
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
        const commission = Number(Math.max(5, proceeds * 0.00025).toFixed(2));
        const stampDuty = Number((proceeds * 0.0005).toFixed(2));
        const transferFee = Number((proceeds * 0.00001).toFixed(2));
        orderFee = Number((commission + stampDuty + transferFee).toFixed(2));
        taxAndFeeDetail = `佣金¥${commission.toFixed(2)} + 印花税¥${stampDuty.toFixed(2)} + 过户费¥${transferFee.toFixed(2)}`;
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
          execNote = `A股卖出平多${qty}股 (${taxAndFeeDetail})`;
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
        taxAndFeeDetail = `交易所手续费¥${orderFee.toFixed(2)} (${leverage}x保证金)`;
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
            SET name = ?, quantity = ?, available_quantity = ?, avg_cost = ?, last_price = ?, leverage = ?, margin_occupied = ?, strategy_tag = ?,
                stop_loss_price = COALESCE(?, stop_loss_price), take_profit_price = COALESCE(?, take_profit_price)
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
            req.stopLossPrice && req.stopLossPrice > 0 ? stopLossPrice : null,
            takeProfitPrice,
            pos.id
          );
        } else {
          tx.prepare(`
            INSERT INTO paper_positions
              (id, portfolio_id, symbol, name, market, side, quantity, available_quantity, avg_cost, last_price, leverage, margin_occupied, strategy_tag, opened_date, last_unlock_date, stop_loss_price, take_profit_price)
            VALUES (?, ?, ?, ?, 'futures', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            tradingDate,
            stopLossPrice,
            takeProfitPrice
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
        taxAndFeeDetail = `交易所手续费¥${orderFee.toFixed(2)}`;
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
        (portfolio_id, created_at, trading_date, symbol, name, market, action, quantity, fill_price, leverage, fee, realized_pnl, strategy_tag, note, exec_id, order_type, slippage_bps, tax_and_fee_detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      execNote,
      execId,
      orderType,
      requestedSlippage,
      taxAndFeeDetail
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
  positionId: string,
  _portfolioId?: string,
  ratio = 1
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

  const totalQty = Number(row.quantity);
  const availQty = row.market === 'futures' ? totalQty : Number(row.available_quantity);
  const safeRatio = Math.max(0.1, Math.min(1, Number(ratio) || 1));

  let closeQty = totalQty;
  if (safeRatio < 0.99) {
    if (row.market === 'ashare') {
      closeQty = Math.floor((availQty * safeRatio) / 100) * 100;
      if (closeQty < 100) closeQty = availQty;
    } else {
      closeQty = Math.max(1, Math.floor(totalQty * safeRatio));
    }
  }

  return placePaperOrder(userId, {
    portfolioId: String(row.portfolio_id),
    symbol: String(row.symbol),
    name: String(row.name),
    market: row.market as 'ashare' | 'futures',
    action: row.side === 'short' ? 'cover_short' : 'sell_long',
    orderType: 'MARKET_IOC',
    quantity: closeQty,
    leverage: Number(row.leverage || 1),
    strategyTag: String(row.strategy_tag || '快速平仓'),
    note: safeRatio < 0.99 ? `持仓面板按市价减仓 ${Math.round(safeRatio * 100)}% (${closeQty})` : '持仓面板市价全平',
  });
}

export async function updatePositionStops(
  userId: string,
  positionId: string,
  payload: { stopLossPrice?: number | null; takeProfitPrice?: number | null; portfolioId?: string }
): Promise<PaperDeskOverviewResponse> {
  const db = getDb();
  const row = db.prepare(`
    SELECT p.*, pf.user_id
    FROM paper_positions p
    JOIN paper_portfolios pf ON pf.id = p.portfolio_id
    WHERE p.id = ? AND pf.user_id = ?
  `).get(positionId, userId) as any;

  if (!row) {
    throw new Error('未找到目标持仓或无权限修改风控止损线');
  }

  const sl =
    payload.stopLossPrice !== undefined
      ? payload.stopLossPrice && payload.stopLossPrice > 0
        ? Number(payload.stopLossPrice)
        : null
      : row.stop_loss_price;
  const tp =
    payload.takeProfitPrice !== undefined
      ? payload.takeProfitPrice && payload.takeProfitPrice > 0
        ? Number(payload.takeProfitPrice)
        : null
      : row.take_profit_price;

  db.prepare(`UPDATE paper_positions SET stop_loss_price = ?, take_profit_price = ? WHERE id = ?`).run(
    sl,
    tp,
    row.id
  );

  return getPaperDeskOverview(userId, payload.portfolioId || String(row.portfolio_id));
}

export async function evaluateOmsStopLossGuards(): Promise<AlertTriggerEvent[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.*, pf.user_id
    FROM paper_positions p
    JOIN paper_portfolios pf ON pf.id = p.portfolio_id
    WHERE p.stop_loss_price IS NOT NULL AND p.stop_loss_price > 0
  `).all() as any[];

  if (rows.length === 0) return [];

  const targets = rows.map((r) => ({
    symbol: String(r.symbol),
    market: r.market as 'ashare' | 'futures',
  }));
  const quoteMap = await resolveBatchQuotes(targets).catch(() => new Map<string, ResolvedQuote>());
  const triggered: AlertTriggerEvent[] = [];

  for (const r of rows) {
    const uid = String(r.user_id);
    const policy = dbGetOmsPolicy(uid);
    if (!policy.autoStopLossGuard) continue;

    const q = quoteMap.get(`${r.market}:${r.symbol}`);
    if (!q || !(q.price > 0)) continue;

    const sl = Number(r.stop_loss_price);
    const breached = r.side === 'short' ? q.price >= sl : q.price <= sl;
    if (!breached) continue;

    const avail = r.market === 'futures' ? Number(r.quantity) : Number(r.available_quantity);
    if (r.market === 'ashare' && avail <= 0) {
      triggered.push({
        id: `sl-lock-${r.id}-${nowBj().slice(0, 10).replace(/-/g, '')}`,
        time: nowBj(),
        ruleId: 'sys-oms-stoploss-lock',
        ruleName: '止损破位(T+1锁仓待解锁)',
        code: String(r.symbol),
        name: String(r.name),
        message: `${r.symbol} ${r.name} 现价 ${q.price.toFixed(2)} 已触及证伪止损 ${sl.toFixed(2)}，因当日买入T+1锁仓将于次日开盘优先市价出清`,
        level: 'warn',
      });
      continue;
    }

    try {
      await placePaperOrder(uid, {
        portfolioId: String(r.portfolio_id),
        symbol: String(r.symbol),
        name: String(r.name),
        market: r.market as 'ashare' | 'futures',
        action: r.side === 'short' ? 'cover_short' : 'sell_long',
        orderType: 'AUTO_GUARD',
        quantity: avail,
        leverage: Number(r.leverage || 1),
        slippageBps: policy.defaultSlippageBps,
        strategyTag: 'OMS证伪止损自动平仓',
        note: `触发证伪止损线 ${sl.toFixed(2)} (现价 ${q.price.toFixed(2)}) 自动市价平仓`,
      });
      triggered.push({
        id: `sl-exec-${r.id}-${Date.now().toString(36)}`,
        time: nowBj(),
        ruleId: 'sys-oms-stoploss-exec',
        ruleName: 'OMS证伪止损已自动平仓',
        code: String(r.symbol),
        name: String(r.name),
        message: `${r.symbol} ${r.name} 跌破止损线 ${sl.toFixed(2)}，已在专户执行 AUTO_GUARD 全额市价平仓 (现价 ${q.price.toFixed(2)})`,
        level: 'critical',
      });
    } catch {
      // ignore failed guard execution on stale cache
    }
  }

  return triggered;
}

export async function evaluateOms4of4AutoFollow(
  profiles: AssetFactBuyPointProfile[]
): Promise<AlertTriggerEvent[]> {
  const ready4of4 = profiles.filter((p) => p.passedConditionsCount >= 4);
  if (ready4of4.length === 0) return [];

  const db = getDb();
  const policies = db
    .prepare(`SELECT * FROM oms_execution_policy WHERE auto_follow_4of4 = 1`)
    .all() as any[];

  if (policies.length === 0) return [];
  const today = await resolveCurrentTradingDate();
  const events: AlertTriggerEvent[] = [];

  for (const pol of policies) {
    const uid = String(pol.user_id);
    const maxAuto = Math.max(1, Number(pol.max_daily_auto_orders || 3));
    const allocPct = Math.max(2, Math.min(35, Number(pol.auto_alloc_pct || 10)));
    const slippageBps = Number(pol.default_slippage_bps ?? 1.5);

    const pf = db
      .prepare(`SELECT id FROM paper_portfolios WHERE user_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1`)
      .get(uid) as { id: string } | undefined;
    if (!pf) continue;

    const cntRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM paper_orders WHERE portfolio_id = ? AND trading_date = ? AND order_type = 'AUTO_SIGNAL'`)
      .get(pf.id, today) as { cnt: number };
    let todayCount = Number(cntRow?.cnt || 0);
    if (todayCount >= maxAuto) continue;

    for (const prof of ready4of4) {
      if (todayCount >= maxAuto) break;
      const market = detectMarket(prof.symbol);
      const sym = normalizeSymbol(prof.symbol, market);
      const action: PaperOrderRequest['action'] =
        prof.recommendedSide === '做空' && market === 'futures' ? 'open_short' : 'buy_long';

      const existsPos = db
        .prepare(`SELECT id FROM paper_positions WHERE portfolio_id = ? AND symbol = ? AND market = ? LIMIT 1`)
        .get(pf.id, sym, market);
      if (existsPos) continue;

      const existsOrdToday = db
        .prepare(`SELECT id FROM paper_orders WHERE portfolio_id = ? AND trading_date = ? AND symbol = ? AND order_type = 'AUTO_SIGNAL' LIMIT 1`)
        .get(pf.id, today, sym);
      if (existsOrdToday) continue;

      try {
        await placePaperOrder(uid, {
          portfolioId: pf.id,
          symbol: sym,
          name: prof.name,
          market,
          action,
          orderType: 'AUTO_SIGNAL',
          capitalAllocationPct: allocPct,
          leverage: market === 'futures' ? 2 : 1,
          slippageBps,
          stopLossPrice: prof.falsificationStopPrice > 0 ? prof.falsificationStopPrice : null,
          strategyTag: '4/4确定买点自动报单',
          note: `四维确定买点触发自动建仓(${allocPct}%配比) · 历史确定胜率 ${prof.deterministicWinRatePct}% · 证伪止损 ${prof.falsificationStopPrice}`,
        });
        todayCount++;
        events.push({
          id: `auto4-${uid}-${sym}-${today.replace(/-/g, '')}`,
          time: nowBj(),
          ruleId: 'sys-oms-auto-4of4',
          ruleName: '4/4确定买点自动报单成交',
          code: sym,
          name: prof.name,
          message: `专户 [${pf.id}] 已自动执行 ${sym} ${prof.name} ${action === 'open_short' ? '开空' : '建仓'} (${allocPct}%净值 · 预设证伪止损 ${prof.falsificationStopPrice})`,
          level: 'critical',
        });
      } catch {
        // insufficient cash or transient quote skip
      }
    }
  }

  return events;
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
    '合同编号',
    '委托类型',
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
    '滑点(bps)',
    '手续费总计',
    '税费明细',
    '实现盈亏',
    '策略来源',
    '备注',
  ].join(',');

  const lines = rows.map((r) =>
    [
      r.id,
      r.exec_id || `EX-${String(r.id).padStart(6, '0')}`,
      r.order_type || 'MARKET_IOC',
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
      r.slippage_bps ?? 1.2,
      r.fee,
      r.tax_and_fee_detail || '',
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
