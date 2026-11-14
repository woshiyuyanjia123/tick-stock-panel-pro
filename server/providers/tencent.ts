import type { IndexQuote, KLineBar, StockQuoteItem } from '../../src/types/market';
import { cachedFetch, fetchGbkTextWithRetry, fetchJsonWithRetry } from '../utils/httpCache';
import {
  cleanCode,
  enrichKLineIndicators,
  getBeijingTimeInfo,
  getMarketLabel,
  toTencentSymbol,
} from '../utils/marketHelpers';

const TENCENT_HEADERS = {
  Referer: 'https://gu.qq.com/',
};

export const CORE_INDICES = [
  { sym: 'sh000001', code: '000001.SH', secid: '1.000001', name: '上证指数' },
  { sym: 'sz399001', code: '399001.SZ', secid: '0.399001', name: '深证成指' },
  { sym: 'sz399006', code: '399006.SZ', secid: '0.399006', name: '创业板指' },
  { sym: 'sh000680', code: '000680.SH', secid: '1.000680', name: '科创综指' },
];

function parseTencentLines(raw: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  const lines = raw.split(';').map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).replace(/^v_/, '').trim();
    const val = line.slice(eqIdx + 1).replace(/^"|"$/g, '');
    map[key] = val.split('~');
  }
  return map;
}

export async function fetchIndices(): Promise<IndexQuote[]> {
  return cachedFetch(
    'tencent_indices',
    15_000,
    async () => {
      const syms = CORE_INDICES.map((i) => i.sym).join(',');
      const text = await fetchGbkTextWithRetry(`https://qt.gtimg.cn/q=${syms}`, TENCENT_HEADERS);
      const parsed = parseTencentLines(text);
      return CORE_INDICES.map((idx) => {
        const p = parsed[idx.sym] || [];
        const price = Number(p[3] || 0);
        const prevClose = Number(p[4] || 0);
        const open = Number(p[5] || 0);
        const volume = Number(p[6] || 0);
        const change = Number(p[31] || (price - prevClose).toFixed(2));
        const changePct = Number(
          p[32] || (prevClose > 0 ? (((price - prevClose) / prevClose) * 100).toFixed(2) : 0)
        );
        const high = Number(p[33] || price);
        const low = Number(p[34] || price);
        const amountWan = Number(p[37] || 0);
        return {
          code: idx.code,
          name: p[1] || idx.name,
          price,
          change,
          changePct,
          open,
          high,
          low,
          prevClose,
          volume,
          amount: amountWan * 10_000,
        };
      });
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

export async function fetchTencentQuotes(codes: string[]): Promise<Record<string, StockQuoteItem>> {
  const uniqueCodes = Array.from(new Set(codes.map(cleanCode))).filter(Boolean);
  if (uniqueCodes.length === 0) return {};

  const out: Record<string, StockQuoteItem> = {};
  const batchSize = 50;
  for (let i = 0; i < uniqueCodes.length; i += batchSize) {
    const slice = uniqueCodes.slice(i, i + batchSize);
    const syms = slice.map(toTencentSymbol).join(',');
    try {
      const text = await fetchGbkTextWithRetry(`https://qt.gtimg.cn/q=${syms}`, TENCENT_HEADERS);
      const parsed = parseTencentLines(text);
      for (const c of slice) {
        const sym = toTencentSymbol(c);
        const p = parsed[sym];
        if (!p || p.length < 38) continue;
        const price = Number(p[3] || 0);
        const prevClose = Number(p[4] || 0);
        const open = Number(p[5] || 0);
        const volume = Number(p[6] || 0);
        const change = Number(p[31] || 0);
        const changePct = Number(p[32] || 0);
        const high = Number(p[33] || 0);
        const low = Number(p[34] || 0);
        const amountWan = Number(p[37] || 0);
        const turnoverRate = Number(p[38] || 0);
        const pe = Number(p[39] || 0);
        const floatCapYi = Number(p[44] || 0);
        const totalCapYi = Number(p[45] || 0);
        const pb = Number(p[46] || 0);
        const volRatio = Number(p[49] || 1);

        out[c] = {
          code: c,
          name: p[1] || c,
          market: getMarketLabel(c),
          price,
          change,
          changePct,
          open,
          high,
          low,
          prevClose,
          volume,
          amount: amountWan * 10_000,
          turnoverRate,
          volumeRatio: Number.isFinite(volRatio) && volRatio > 0 ? volRatio : 1,
          marketCap: totalCapYi * 1e8,
          floatMarketCap: floatCapYi * 1e8,
          pe: Number.isFinite(pe) ? pe : undefined,
          pb: Number.isFinite(pb) ? pb : undefined,
        };
      }
    } catch {
      // continue remaining batches
    }
  }
  return out;
}

export async function fetchTencentKLines(
  symbolOrCode: string,
  days = 260,
  isIndex = false
): Promise<KLineBar[]> {
  const sym = isIndex
    ? symbolOrCode.startsWith('sh') || symbolOrCode.startsWith('sz')
      ? symbolOrCode
      : `sh${cleanCode(symbolOrCode)}`
    : toTencentSymbol(symbolOrCode);
  const code = cleanCode(symbolOrCode);

  return cachedFetch(
    `tencent_kline_${sym}_${days}`,
    120_000,
    async () => {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,${days},qfq`;
      const json = await fetchJsonWithRetry<any>(url, TENCENT_HEADERS);
      const node = json?.data?.[sym];
      const rawRows: any[][] = node?.qfqday || node?.day || [];
      const bars = rawRows
        .map((r) => {
          const date = String(r[0]);
          const open = Number(r[1]);
          const close = Number(r[2]);
          const high = Number(r[3]);
          const low = Number(r[4]);
          const volume = Number(r[5] || 0);
          return {
            date,
            open,
            close,
            high,
            low,
            volume,
            amount: Number((volume * close * 100).toFixed(0)),
            changePct: NaN,
          };
        })
        .filter((b) => b.date && Number.isFinite(b.close) && b.close > 0);

      return enrichKLineIndicators(bars, isIndex ? undefined : code);
    },
    { persistDisk: true, diskMaxAgeMs: 43_200_000 }
  );
}

export async function resolveTradingDates(): Promise<{
  latestDate: string;
  latestCompact: string;
  prevDate: string;
  prevCompact: string;
  recentDates: string[];
  isMarketOpen: boolean;
}> {
  const bj = getBeijingTimeInfo();
  try {
    const klines = await fetchTencentKLines('sh000001', 15, true);
    if (klines.length > 0) {
      const dates = klines.map((k) => k.date);
      const latestDate = dates[dates.length - 1];
      const prevDate = dates.length >= 2 ? dates[dates.length - 2] : latestDate;
      return {
        latestDate,
        latestCompact: latestDate.replace(/-/g, ''),
        prevDate,
        prevCompact: prevDate.replace(/-/g, ''),
        recentDates: dates,
        isMarketOpen: bj.isMarketOpen && latestDate === bj.dateStr,
      };
    }
  } catch {
    // fallback below
  }

  // Fallback to weekday calculation
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  const latestDate = d.toISOString().slice(0, 10);
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  while (prev.getDay() === 0 || prev.getDay() === 6) {
    prev.setDate(prev.getDate() - 1);
  }
  const prevDate = prev.toISOString().slice(0, 10);
  return {
    latestDate,
    latestCompact: latestDate.replace(/-/g, ''),
    prevDate,
    prevCompact: prevDate.replace(/-/g, ''),
    recentDates: [prevDate, latestDate],
    isMarketOpen: bj.isMarketOpen,
  };
}
