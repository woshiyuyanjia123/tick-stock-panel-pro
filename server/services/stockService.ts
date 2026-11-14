import type { StockDetailResponse, StockQuoteItem, StockSearchItem, WatchlistItem } from '../../src/types/market';
import {
  fetchAllAShareSnapshots,
  fetchStockFinancials,
  fetchStockKLinesEM,
  fetchStockTrends,
} from '../providers/eastmoney';
import { fetchTencentKLines, fetchTencentQuotes, resolveTradingDates } from '../providers/tencent';
import { calcLimitPrices, cleanCode, getMarketLabel } from '../utils/marketHelpers';
import { getStoredWatchlist } from './storageService';

export async function searchStocks(q: string): Promise<StockSearchItem[]> {
  const query = String(q || '').trim().toLowerCase();
  const snapshots = await fetchAllAShareSnapshots().catch(() => []);
  if (!query) {
    return snapshots.slice(0, 20).map((s) => ({
      code: s.code,
      name: s.name,
      market: s.market || getMarketLabel(s.code),
      price: s.price,
      changePct: s.changePct,
      industry: s.industry,
    }));
  }

  const exact: StockQuoteItem[] = [];
  const prefix: StockQuoteItem[] = [];
  const contains: StockQuoteItem[] = [];

  for (const s of snapshots) {
    const c = s.code.toLowerCase();
    const n = s.name.toLowerCase();
    if (c === query || n === query) exact.push(s);
    else if (c.startsWith(query) || n.startsWith(query)) prefix.push(s);
    else if (c.includes(query) || n.includes(query)) contains.push(s);
  }

  return [...exact, ...prefix, ...contains].slice(0, 25).map((s) => ({
    code: s.code,
    name: s.name,
    market: s.market || getMarketLabel(s.code),
    price: s.price,
    changePct: s.changePct,
    industry: s.industry,
  }));
}

export async function getStockDetail(
  rawCode: string,
  days = 120,
  requestedDate?: string
): Promise<StockDetailResponse> {
  const code = cleanCode(rawCode);
  const dates = await resolveTradingDates();
  const selectedDate = requestedDate || dates.latestDate;

  const [snapshots, emKlineRes, trends, financials] = await Promise.all([
    fetchAllAShareSnapshots().catch(() => [] as StockQuoteItem[]),
    fetchStockKLinesEM(code, Math.max(days, 120)).catch(async () => {
      const klines = await fetchTencentKLines(code, Math.max(days, 120), false);
      return { name: code, klines };
    }),
    fetchStockTrends(code).catch(() => ({
      prevClose: 0,
      points: [],
      totalVolume: 0,
      totalAmount: 0,
    })),
    fetchStockFinancials(code).catch(() => null),
  ]);

  let quote = snapshots.find((s) => cleanCode(s.code) === code);
  if (!quote) {
    const tq = await fetchTencentQuotes([code]).catch(() => ({}));
    quote = tq[code];
  }

  const klines = emKlineRes.klines.slice(-days);
  const lastBar = klines[klines.length - 1];
  const prevBar = klines[klines.length - 2];

  if (!quote) {
    const price = lastBar?.close || 0;
    const prevClose = prevBar?.close || lastBar?.open || price;
    quote = {
      code,
      name: emKlineRes.name || code,
      market: getMarketLabel(code),
      price,
      change: Number((price - prevClose).toFixed(2)),
      changePct: lastBar?.changePct || 0,
      open: lastBar?.open || price,
      high: lastBar?.high || price,
      low: lastBar?.low || price,
      prevClose,
      volume: lastBar?.volume || 0,
      amount: lastBar?.amount || 0,
      turnoverRate: lastBar?.turnoverRate || 0,
      volumeRatio: lastBar?.volRatio || 1,
    };
  }

  const watchlist = getStoredWatchlist();
  const wlEntry = watchlist.find((w) => cleanCode(w.code) === code);

  const prevClose = trends.prevClose > 0 ? trends.prevClose : quote.prevClose || quote.price;
  const limits = calcLimitPrices(prevClose, code, quote.name);

  // Quantitative diagnosis
  const recent20 = klines.slice(-20);
  const supportLevel = recent20.length
    ? Math.min(...recent20.map((b) => b.low))
    : Number((quote.price * 0.92).toFixed(2));
  const resistanceLevel = recent20.length
    ? Math.max(...recent20.map((b) => b.high))
    : Number((quote.price * 1.08).toFixed(2));

  let trendScore = 50;
  if (lastBar?.ma5 && lastBar.close >= lastBar.ma5) trendScore += 15;
  if (lastBar?.ma10 && lastBar.close >= lastBar.ma10) trendScore += 12;
  if (lastBar?.ma20 && lastBar.close >= lastBar.ma20) trendScore += 13;
  if (lastBar?.ma60 && lastBar.close >= lastBar.ma60) trendScore += 10;

  const vr = quote.volumeRatio || lastBar?.volRatio || 1;
  const volumeScore = Math.min(95, Math.max(25, Math.round(45 + vr * 18)));
  const chipScore = Math.min(
    95,
    Math.max(30, Math.round(60 + (quote.turnoverRate >= 3 && quote.turnoverRate <= 18 ? 20 : -5)))
  );
  const limitHits20 = recent20.filter((b) => b.marker === '板').length;
  const brokenHits20 = recent20.filter((b) => b.marker === '炸').length;
  const limitGeneScore = Math.min(98, 40 + limitHits20 * 18 + brokenHits20 * 6);
  const totalScore = Math.round(
    trendScore * 0.35 + volumeScore * 0.25 + chipScore * 0.2 + limitGeneScore * 0.2
  );

  const signals: string[] = [];
  if (lastBar?.ma5 && lastBar?.ma10 && lastBar?.ma20 && lastBar.ma5 > lastBar.ma10 && lastBar.ma10 > lastBar.ma20) {
    signals.push('均线多头排列');
  }
  if (lastBar?.ma20 && lastBar.close >= lastBar.ma20) {
    signals.push('站稳MA20生命线');
  } else if (lastBar?.ma20) {
    signals.push('MA20下方蓄势');
  }
  if (vr >= 1.5) signals.push(`放量异动 (量比 ${vr.toFixed(2)}x)`);
  if (limitHits20 > 0) signals.push(`近20日涨停 ${limitHits20} 次 (含涨停基因)`);
  if (quote.turnoverRate >= 8) signals.push(`高换手活跃 (${quote.turnoverRate.toFixed(2)}%)`);
  if (signals.length === 0) signals.push('缩量震荡观察');

  return {
    code,
    name: quote.name,
    market: quote.market || getMarketLabel(code),
    industry: quote.industry || '综合',
    concepts: quote.industry ? [quote.industry] : [],
    quote,
    selectedDate,
    watchlistAdded: Boolean(wlEntry),
    watchlistSince: wlEntry?.addedAt,
    klines,
    intraday: {
      date: selectedDate,
      prevClose,
      limitUpPrice: limits.up,
      limitDownPrice: limits.down,
      totalVolume: trends.totalVolume || quote.volume,
      totalAmount: trends.totalAmount || quote.amount,
      points: trends.points,
    },
    financials: financials
      ? {
          ...financials,
          pe: quote.pe || 0,
          pb: quote.pb || 0,
        }
      : undefined,
    diagnosis: {
      totalScore,
      trendScore: Math.min(100, trendScore),
      volumeScore,
      chipScore,
      limitGeneScore,
      supportLevel: Number(supportLevel.toFixed(2)),
      resistanceLevel: Number(resistanceLevel.toFixed(2)),
      signals,
    },
  };
}

export async function getWatchlistWithQuotes(list: WatchlistItem[]): Promise<WatchlistItem[]> {
  if (list.length === 0) return [];
  const snapshots = await fetchAllAShareSnapshots().catch(() => [] as StockQuoteItem[]);
  const snapMap = new Map(snapshots.map((s) => [cleanCode(s.code), s]));
  const missing = list.map((w) => cleanCode(w.code)).filter((c) => !snapMap.has(c));

  if (missing.length > 0) {
    const extra = await fetchTencentQuotes(missing).catch(() => ({}));
    for (const [k, v] of Object.entries(extra)) {
      snapMap.set(cleanCode(k), v);
    }
  }

  return list.map((w) => {
    const q = snapMap.get(cleanCode(w.code));
    return {
      ...w,
      name: q?.name || w.name,
      quote: q,
    };
  });
}
