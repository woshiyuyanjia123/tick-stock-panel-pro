import type {
  AnomalyItem,
  FinancialPeriod,
  IntradayPoint,
  KLineBar,
  StockQuoteItem,
} from '../../src/types/market';
import { cachedFetch, fetchJsonWithRetry } from '../utils/httpCache';
import {
  cleanCode,
  enrichKLineIndicators,
  formatTimeInt,
  getBeijingTimeInfo,
  getMarketLabel,
  getMarketPrefix,
  toEastMoneySecid,
} from '../utils/marketHelpers';

const EM_HEADERS = {
  Referer: 'https://quote.eastmoney.com/',
};

export interface EMBoardRaw {
  code: string;
  name: string;
  price: number;
  changePct: number;
  amount: number;
  turnoverRate: number;
  upCount: number;
  downCount: number;
  flatCount: number;
  leaderCode: string;
  leaderName: string;
  leaderChangePct: number;
}

export interface EMPoolRaw {
  c: string;
  m: number;
  n: string;
  p: number; // milli-yuan
  ztp?: number;
  zdp: number;
  amount: number;
  ltsz: number;
  tshare: number;
  hs: number;
  lbc?: number;
  fbt?: number;
  lbt?: number;
  fund?: number;
  zbc?: number;
  zf?: number;
  zs?: number;
  hybk?: string;
  zttj?: { days: number; ct: number };
}

function mapClistItem(d: any): StockQuoteItem {
  const code = cleanCode(String(d.f12 || ''));
  const num = (v: any, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  return {
    code,
    name: String(d.f14 || code),
    market: getMarketLabel(code),
    price: num(d.f2),
    changePct: num(d.f3),
    change: num(d.f4),
    volume: num(d.f5),
    amount: num(d.f6),
    turnoverRate: num(d.f8),
    pe: typeof d.f9 === 'number' ? d.f9 : undefined,
    volumeRatio: num(d.f10, 1),
    high: num(d.f15, num(d.f2)),
    low: num(d.f16, num(d.f2)),
    open: num(d.f17, num(d.f2)),
    prevClose: num(d.f18, num(d.f2)),
    marketCap: num(d.f20),
    floatMarketCap: num(d.f21),
    pb: typeof d.f23 === 'number' ? d.f23 : undefined,
    industry: typeof d.f100 === 'string' && d.f100 !== '-' ? d.f100 : undefined,
  };
}

export async function fetchAllAShareSnapshots(): Promise<StockQuoteItem[]> {
  const { isMarketOpen } = getBeijingTimeInfo();
  const ttlMs = isMarketOpen ? 60_000 : 3_600_000;
  const diskMaxAgeMs = isMarketOpen ? 300_000 : 43_200_000;

  return cachedFetch(
    'em_all_ashares',
    ttlMs,
    async () => {
      const baseUrl =
        'https://push2.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f6&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=f2,f3,f4,f5,f6,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21,f23,f100';

      const first = await fetchJsonWithRetry<any>(`${baseUrl}&pn=1`, EM_HEADERS, 10_000);
      const total = Number(first?.data?.total || 0);
      const diff1: any[] = first?.data?.diff || [];
      const all: StockQuoteItem[] = diff1.map(mapClistItem);

      const totalPages = Math.min(Math.ceil(total / 100), 65);
      const concurrency = 4;
      for (let start = 2; start <= totalPages; start += concurrency) {
        const batch: Promise<void>[] = [];
        for (let pn = start; pn < start + concurrency && pn <= totalPages; pn++) {
          batch.push(
            fetchJsonWithRetry<any>(`${baseUrl}&pn=${pn}`, EM_HEADERS, 10_000)
              .then((res) => {
                const items: any[] = res?.data?.diff || [];
                for (const d of items) all.push(mapClistItem(d));
              })
              .catch(() => {
                // ignore single page blip
              })
          );
        }
        await Promise.all(batch);
        await new Promise((r) => setTimeout(r, 120));
      }

      // Filter out suspended / invalid price stocks for clean stats, keeping unique codes
      const seen = new Set<string>();
      const valid: StockQuoteItem[] = [];
      for (const item of all) {
        if (!item.code || seen.has(item.code)) continue;
        seen.add(item.code);
        if (item.price > 0) valid.push(item);
      }
      if (valid.length === 0) throw new Error('Empty A-share snapshots');
      return valid;
    },
    { persistDisk: true, diskMaxAgeMs }
  );
}

export async function fetchTopAShareSlice(sortField = 'f3', pages = 2): Promise<StockQuoteItem[]> {
  return cachedFetch(
    `em_slice_${sortField}_${pages}`,
    45_000,
    async () => {
      const baseUrl = `https://push2.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=${sortField}&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=f2,f3,f4,f5,f6,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21,f23,f100`;
      const results: StockQuoteItem[] = [];
      for (let pn = 1; pn <= pages; pn++) {
        const res = await fetchJsonWithRetry<any>(`${baseUrl}&pn=${pn}`, EM_HEADERS);
        const diff: any[] = res?.data?.diff || [];
        for (const d of diff) {
          const mapped = mapClistItem(d);
          if (mapped.price > 0) results.push(mapped);
        }
      }
      return results;
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

export async function fetchZTPool(dateCompact: string): Promise<EMPoolRaw[]> {
  return cachedFetch(
    `em_zt_${dateCompact}`,
    60_000,
    async () => {
      const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&Pagesize=500&sort=lbc:desc&date=${dateCompact}`;
      const json = await fetchJsonWithRetry<any>(url, EM_HEADERS);
      return (json?.data?.pool || []) as EMPoolRaw[];
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

export async function fetchZBPool(dateCompact: string): Promise<EMPoolRaw[]> {
  return cachedFetch(
    `em_zb_${dateCompact}`,
    60_000,
    async () => {
      const url = `https://push2ex.eastmoney.com/getTopicZBPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&Pagesize=500&sort=fbt:asc&date=${dateCompact}`;
      const json = await fetchJsonWithRetry<any>(url, EM_HEADERS);
      return (json?.data?.pool || []) as EMPoolRaw[];
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

export async function fetchDTPool(dateCompact: string): Promise<EMPoolRaw[]> {
  return cachedFetch(
    `em_dt_${dateCompact}`,
    60_000,
    async () => {
      const url = `https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&Pagesize=500&sort=fund:asc&date=${dateCompact}`;
      const json = await fetchJsonWithRetry<any>(url, EM_HEADERS);
      return (json?.data?.pool || []) as EMPoolRaw[];
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

export async function fetchQSPool(dateCompact: string): Promise<EMPoolRaw[]> {
  return cachedFetch(
    `em_qs_${dateCompact}`,
    60_000,
    async () => {
      const url = `https://push2ex.eastmoney.com/getTopicQSPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&Pagesize=500&sort=zdp:desc&date=${dateCompact}`;
      const json = await fetchJsonWithRetry<any>(url, EM_HEADERS);
      return (json?.data?.pool || []) as EMPoolRaw[];
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

function mapBoard(d: any): EMBoardRaw {
  const num = (v: any, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  return {
    code: String(d.f12 || ''),
    name: String(d.f14 || ''),
    price: num(d.f2),
    changePct: num(d.f3),
    amount: num(d.f6),
    turnoverRate: num(d.f8),
    upCount: num(d.f104),
    downCount: num(d.f105),
    flatCount: num(d.f106),
    leaderName: String(d.f128 || ''),
    leaderCode: cleanCode(String(d.f140 || '')),
    leaderChangePct: num(d.f136),
  };
}

async function fetchBoardList(fs: string, cacheKey: string): Promise<EMBoardRaw[]> {
  return cachedFetch(
    cacheKey,
    60_000,
    async () => {
      const baseUrl = `https://push2.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(
        fs
      )}&fields=f2,f3,f6,f8,f12,f14,f104,f105,f106,f128,f136,f140`;
      const first = await fetchJsonWithRetry<any>(`${baseUrl}&pn=1`, EM_HEADERS);
      const total = Number(first?.data?.total || 0);
      const list: EMBoardRaw[] = (first?.data?.diff || []).map(mapBoard);
      const pages = Math.min(Math.ceil(total / 100), 8);

      const batch: Promise<void>[] = [];
      for (let pn = 2; pn <= pages; pn++) {
        batch.push(
          fetchJsonWithRetry<any>(`${baseUrl}&pn=${pn}`, EM_HEADERS)
            .then((res) => {
              for (const d of res?.data?.diff || []) list.push(mapBoard(d));
            })
            .catch(() => {})
        );
      }
      await Promise.all(batch);
      return list.filter((b) => b.code && b.name);
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

export function fetchConceptBoards(): Promise<EMBoardRaw[]> {
  return fetchBoardList('m:90+t:3+f:!50', 'em_concepts');
}

export function fetchIndustryBoards(): Promise<EMBoardRaw[]> {
  return fetchBoardList('m:90+t:2+f:!50', 'em_industries');
}

export async function fetchBoardConstituents(bkCode: string, limit = 100): Promise<StockQuoteItem[]> {
  return cachedFetch(
    `em_bk_cons_${bkCode}_${limit}`,
    300_000,
    async () => {
      const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${Math.min(
        limit,
        100
      )}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=b:${encodeURIComponent(
        bkCode
      )}+f:!50&fields=f2,f3,f4,f5,f6,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21,f23,f100`;
      const json = await fetchJsonWithRetry<any>(url, EM_HEADERS, 9000, 2);
      const list = ((json?.data?.diff || []) as any[])
        .map(mapClistItem)
        .filter((s) => s.price > 0);
      if (list.length === 0) {
        throw new Error(`Empty constituents for ${bkCode}`);
      }
      return list;
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

export async function fetchStockKLinesEM(
  secidOrCode: string,
  days = 260
): Promise<{ name: string; klines: KLineBar[] }> {
  const secid = secidOrCode.includes('.')
    ? secidOrCode
    : secidOrCode.startsWith('BK')
    ? `90.${secidOrCode}`
    : toEastMoneySecid(secidOrCode);

  return cachedFetch(
    `em_kline_${secid}_${days}`,
    120_000,
    async () => {
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(
        secid
      )}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${days}`;
      const json = await fetchJsonWithRetry<any>(url, EM_HEADERS);
      const name = String(json?.data?.name || secidOrCode);
      const rows: string[] = json?.data?.klines || [];
      const bars = rows.map((line) => {
        const [date, o, c, h, l, v, amt, , pct, , hs] = line.split(',');
        return {
          date,
          open: Number(o),
          close: Number(c),
          high: Number(h),
          low: Number(l),
          volume: Number(v),
          amount: Number(amt),
          changePct: Number(pct),
          turnoverRate: Number(hs),
        };
      });
      const isBoardOrIndex = secid.startsWith('90.') || secid === '1.000001';
      return {
        name,
        klines: enrichKLineIndicators(bars, isBoardOrIndex ? undefined : cleanCode(secidOrCode), name),
      };
    },
    { persistDisk: true, diskMaxAgeMs: 43_200_000 }
  );
}

export async function fetchStockTrends(secidOrCode: string): Promise<{
  prevClose: number;
  points: IntradayPoint[];
  totalVolume: number;
  totalAmount: number;
}> {
  const secid = secidOrCode.includes('.') ? secidOrCode : toEastMoneySecid(secidOrCode);
  return cachedFetch(
    `em_trends_${secid}`,
    20_000,
    async () => {
      const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ut=fa5fd1943c7b386f172d6893dbfba10b&iscr=0&ndays=1&secid=${encodeURIComponent(
        secid
      )}`;
      const json = await fetchJsonWithRetry<any>(url, EM_HEADERS);
      const prevClose = Number(json?.data?.preClose || 0);
      const raw: string[] = json?.data?.trends || [];
      let totalVolume = 0;
      let totalAmount = 0;
      const points: IntradayPoint[] = raw.map((row) => {
        const parts = row.split(',');
        const time = (parts[0] || '').split(' ')[1] || parts[0];
        const price = Number(parts[2] || parts[1] || 0);
        const volume = Number(parts[5] || 0);
        const amount = Number(parts[6] || 0);
        const avgPrice = Number(parts[7] || price);
        totalVolume += volume;
        totalAmount += amount;
        const changePct =
          prevClose > 0 ? Number((((price - prevClose) / prevClose) * 100).toFixed(2)) : 0;
        return {
          time,
          price,
          avgPrice,
          volume,
          changePct,
        };
      });
      return { prevClose, points, totalVolume, totalAmount };
    },
    { persistDisk: true, diskMaxAgeMs: 43_200_000 }
  );
}

export async function fetchStockFinancials(code: string): Promise<{
  reportDate: string;
  revenue: number;
  revenueYoY: number;
  netProfit: number;
  netProfitYoY: number;
  roe: number;
  grossMargin: number;
  debtRatio: number;
  eps: number;
  history: FinancialPeriod[];
} | null> {
  const c = cleanCode(code);
  const prefix = getMarketPrefix(c).toUpperCase();
  return cachedFetch(
    `em_f10_${prefix}${c}`,
    3_600_000,
    async () => {
      const url = `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${prefix}${c}`;
      const json = await fetchJsonWithRetry<any>(url, EM_HEADERS);
      const rows: any[] = json?.data || [];
      if (!rows.length) return null;

      const latest = rows[0];
      const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(2)) : 0);
      const history: FinancialPeriod[] = rows.slice(0, 8).reverse().map((r) => ({
        period: String(r.REPORT_DATE_NAME || String(r.REPORT_DATE || '').slice(0, 10)),
        revenue: Number(r.TOTALOPERATEREVE || 0),
        revenueYoY: num(r.TOTALOPERATEREVETZ),
        netProfit: Number(r.PARENTNETPROFIT || 0),
        netProfitYoY: num(r.PARENTNETPROFITTZ),
        roe: num(r.ROEJQ),
        grossMargin: num(r.XSMLL),
        debtRatio: num(r.ZCFZL),
      }));

      return {
        reportDate: String(latest.REPORT_DATE_NAME || String(latest.REPORT_DATE || '').slice(0, 10)),
        revenue: Number(latest.TOTALOPERATEREVE || 0),
        revenueYoY: num(latest.TOTALOPERATEREVETZ),
        netProfit: Number(latest.PARENTNETPROFIT || 0),
        netProfitYoY: num(latest.PARENTNETPROFITTZ),
        roe: num(latest.ROEJQ),
        grossMargin: num(latest.XSMLL),
        debtRatio: num(latest.ZCFZL),
        eps: num(latest.EPSJB),
        history,
      };
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  ).catch(() => null);
}

const CHANGE_TYPE_MAP: Record<number, { label: string; direction: 'bull' | 'bear' }> = {
  8201: { label: '火箭发射', direction: 'bull' },
  8202: { label: '快速反弹', direction: 'bull' },
  8193: { label: '大笔买入', direction: 'bull' },
  4: { label: '封涨停板', direction: 'bull' },
  8207: { label: '竞价上涨', direction: 'bull' },
  8209: { label: '高开5日线', direction: 'bull' },
  8211: { label: '向上缺口', direction: 'bull' },
  8213: { label: '60日新高', direction: 'bull' },
  8215: { label: '60日大幅上涨', direction: 'bull' },
  128: { label: '打开跌停板', direction: 'bull' },
  8204: { label: '加速下跌', direction: 'bear' },
  8203: { label: '高台跳水', direction: 'bear' },
  8194: { label: '大笔卖出', direction: 'bear' },
  8: { label: '打开涨停板', direction: 'bear' },
  16: { label: '有大买盘', direction: 'bull' },
  32: { label: '封跌停板', direction: 'bear' },
  64: { label: '有大卖盘', direction: 'bear' },
  8208: { label: '竞价下跌', direction: 'bear' },
  8210: { label: '低开5日线', direction: 'bear' },
  8212: { label: '向下缺口', direction: 'bear' },
  8214: { label: '60日新低', direction: 'bear' },
  8216: { label: '60日大幅下跌', direction: 'bear' },
};

export async function fetchStockChanges(limit = 60): Promise<AnomalyItem[]> {
  return cachedFetch(
    `em_changes_${limit}`,
    20_000,
    async () => {
      const url = `https://push2ex.eastmoney.com/getAllStockChanges?type=8201,8202,8193,4,32,64,8207,8209,8211,8213,8215,8204,8203,8194,8,16,128,8208,8210,8212,8214,8216&ut=7eea3edcaed734bea9cbfc24409ed989&pageindex=0&pagesize=${limit}&dpt=wzchanges`;
      const json = await fetchJsonWithRetry<any>(url, EM_HEADERS);
      const list: any[] = json?.data?.allstock || [];
      return list.map((item, idx) => {
        const meta = CHANGE_TYPE_MAP[Number(item.t)] || {
          label: `异动(${item.t})`,
          direction: 'bull' as const,
        };
        const infoParts = String(item.i || '').split(',');
        const price = Number(infoParts[0] || 0);
        const rawPct = Number(infoParts[1] || 0);
        const changePct = Math.abs(rawPct) <= 0.35 ? Number((rawPct * 100).toFixed(2)) : Number(rawPct.toFixed(2));
        const timeStr = formatTimeInt(item.tm);
        return {
          id: `${item.c}-${item.tm}-${item.t}-${idx}`,
          time: timeStr,
          code: cleanCode(String(item.c)),
          name: String(item.n || item.c),
          type: meta.label,
          direction: meta.direction,
          price,
          changePct,
          detail: `${meta.label} · 现价 ${price.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`,
        };
      });
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}
