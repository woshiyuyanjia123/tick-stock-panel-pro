import type {
  CpoCoreAnchorItem,
  CpoDagNodeState,
  CpoGateStatus,
  CpoPlaybookItem,
  CpoSecondOrderTarget,
  CpoTransmissionBacktestRequest,
  CpoTransmissionBacktestResponse,
  CpoTransmissionOverviewResponse,
  CpoTrapAlert,
  KLineBar,
  StockQuoteItem,
  UsOpticsAnchorItem,
} from '../../src/types/market';
import {
  fetchAllAShareSnapshots,
  fetchIndustryBoards,
  fetchStockTrends,
} from '../providers/eastmoney';
import {
  fetchTencentKLines,
  fetchTencentQuotes,
} from '../providers/tencent';
import {
  cachedFetch,
  fetchGbkTextWithRetry,
  fetchJsonWithRetry,
} from '../utils/httpCache';
import { cleanCode, getBeijingTimeInfo } from '../utils/marketHelpers';
import {
  fetch28FuturesQuotes,
  fetchFuturesKLines,
  loadPolymarketEvents,
} from './pandaPmService';

const TENCENT_HEADERS = {
  Referer: 'https://gu.qq.com/',
};

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn',
};

interface UsAnchorSpec {
  symbol: string;
  qtSym: string;
  klineSym: string;
  name: string;
  role: string;
  weight: number;
}

const US_OPTICS_ANCHORS: UsAnchorSpec[] = [
  { symbol: 'COHR', qtSym: 'usCOHR', klineSym: 'usCOHR.N', name: 'Coherent 高意', role: '光模块原厂1:1映射', weight: 0.24 },
  { symbol: 'LITE', qtSym: 'usLITE', klineSym: 'usLITE.OQ', name: 'Lumentum 朗美通', role: 'EML光芯片/OCS锚', weight: 0.22 },
  { symbol: 'FN', qtSym: 'usFN', klineSym: 'usFN.N', name: 'Fabrinet', role: '800G/1.6T光模块代工锚', weight: 0.18 },
  { symbol: 'AVGO', qtSym: 'usAVGO', klineSym: 'usAVGO.OQ', name: 'Broadcom 博通', role: 'DSP/定制ASIC/CPO交换机锚', weight: 0.14 },
  { symbol: 'NVDA', qtSym: 'usNVDA', klineSym: 'usNVDA.OQ', name: 'Nvidia 英伟达', role: 'GPU算力总锚', weight: 0.12 },
  { symbol: 'MRVL', qtSym: 'usMRVL', klineSym: 'usMRVL.OQ', name: 'Marvell 迈威尔', role: '800G PAM4 DSP锚', weight: 0.10 },
];

interface CpoAnchorSpec {
  code: string;
  name: string;
  weight: number;
}

const CPO_CORE_ANCHORS: CpoAnchorSpec[] = [
  { code: '300308', name: '中际旭创', weight: 0.40 },
  { code: '300502', name: '新易盛', weight: 0.35 },
  { code: '300394', name: '天孚通信', weight: 0.25 },
];

interface HardwareTargetSpec {
  code: string;
  name: string;
  subSector: string;
}

const SECOND_ORDER_UNIVERSE: HardwareTargetSpec[] = [
  { code: '002837', name: '英维克', subSector: '液冷散热' },
  { code: '002463', name: '沪电股份', subSector: 'AI高端PCB' },
  { code: '688256', name: '寒武纪', subSector: '国产算力ASIC' },
  { code: '688041', name: '海光信息', subSector: '国产算力ASIC' },
  { code: '601138', name: '工业富联', subSector: 'AI服务器' },
  { code: '300570', name: '太辰光', subSector: 'MPO/铜连接' },
  { code: '002851', name: '麦格米特', subSector: 'AI电源' },
  { code: '688498', name: '源杰科技', subSector: '光芯片' },
  { code: '002281', name: '光迅科技', subSector: '光芯片' },
  { code: '603019', name: '中科曙光', subSector: 'AI服务器' },
  { code: '000977', name: '浪潮信息', subSector: 'AI服务器' },
  { code: '300308', name: '中际旭创', subSector: '一阶CPO核心锚' },
  { code: '300502', name: '新易盛', subSector: '一阶CPO核心锚' },
  { code: '300394', name: '天孚通信', subSector: '一阶CPO核心锚' },
];

const TMT_INDUSTRY_KEYWORDS = [
  '半导体',
  '通信设备',
  '计算机设备',
  '软件开发',
  '元件',
  '光学光电子',
  '消费电子',
  '互联网服务',
  '游戏',
  '文化传媒',
  '传媒',
  '电子化学品',
  '通信服务',
  'IT服务',
];

interface SimpleBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  changePct: number;
}

// ---------- Math & Statistical Helpers ----------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-clamp(x, -12, 12)));
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let ss = 0;
  for (const x of arr) ss += (x - m) ** 2;
  return Math.sqrt(ss / (arr.length - 1));
}

function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 6) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  const denom = Math.sqrt(vx * vy);
  return denom < 1e-12 ? 0 : clamp(cov / denom, -0.999, 0.999);
}

function olsRegression(x: number[], y: number[]): { alpha: number; beta: number; residStd: number } {
  const n = Math.min(x.length, y.length);
  if (n < 8) return { alpha: 0, beta: 1, residStd: 1.5 };
  const xs = x.slice(-n);
  const ys = y.slice(-n);
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
  }
  const beta = vx > 1e-10 ? clamp(cov / vx, -0.5, 2.5) : 1;
  const alpha = my - beta * mx;
  const resids: number[] = [];
  for (let i = 0; i < n; i++) {
    resids.push(ys[i] - (alpha + beta * xs[i]));
  }
  const residStd = Math.max(0.45, stdDev(resids));
  return { alpha, beta, residStd };
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function bsOptionPrice(
  isCall: boolean,
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number
): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (isCall) {
    return S * normalCdf(d1) - K * Math.exp(-r * T) * normalCdf(d2);
  }
  return K * Math.exp(-r * T) * normalCdf(-d2) - S * normalCdf(-d1);
}

function impliedVolatility(
  isCall: boolean,
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r = 0.018
): number | null {
  const intrinsic = Math.max(0, isCall ? S - K : K - S);
  if (marketPrice <= intrinsic + 1e-4 || T <= 1 / 365) return null;
  let lo = 0.05;
  let hi = 2.0;
  for (let iter = 0; iter < 32; iter++) {
    const mid = (lo + hi) / 2;
    const p = bsOptionPrice(isCall, S, K, T, r, mid);
    if (p > marketPrice) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function computeSharpe(dailyReturns: number[]): number {
  if (dailyReturns.length < 5) return 0;
  const m = mean(dailyReturns);
  const s = stdDev(dailyReturns);
  if (s < 1e-8) return 0;
  return round((m / s) * Math.sqrt(252), 2);
}

function computeInfoRatio(stratRets: number[], benchRets: number[]): number {
  const n = Math.min(stratRets.length, benchRets.length);
  if (n < 5) return 0;
  const diff: number[] = [];
  for (let i = 0; i < n; i++) diff.push(stratRets[i] - benchRets[i]);
  const m = mean(diff);
  const s = stdDev(diff);
  if (s < 1e-8) return 0;
  return round((m / s) * Math.sqrt(252), 2);
}

// ---------- Live Data Fetchers ----------

async function fetchUsOpticsQuotes(): Promise<{
  quotes: Record<string, { name: string; price: number; changePct: number; volume: number }>;
}> {
  return cachedFetch(
    'cpo_us_optics_qt_v1',
    30_000,
    async () => {
      const syms = US_OPTICS_ANCHORS.map((a) => a.qtSym).join(',');
      const text = await fetchGbkTextWithRetry(
        `https://qt.gtimg.cn/q=${syms}`,
        TENCENT_HEADERS,
        7000,
        2
      );
      const quotes: Record<string, { name: string; price: number; changePct: number; volume: number }> = {};
      for (const line of text.split(';')) {
        const idx = line.indexOf('=');
        if (idx < 0) continue;
        const key = line.slice(0, idx).replace(/^v_/, '').trim();
        const raw = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
        const p = raw.split('~');
        if (p.length < 35) continue;
        const sym = key.replace(/^us/, '');
        const price = Number(p[3] || 0);
        const prevClose = Number(p[4] || 0);
        const volume = Number(p[6] || p[36] || 0);
        const changePct = Number(
          p[32] || (prevClose > 0 ? (((price - prevClose) / prevClose) * 100).toFixed(2) : 0)
        );
        if (price > 0) {
          quotes[sym] = {
            name: p[1] || sym,
            price: round(price, 2),
            changePct: round(changePct, 2),
            volume,
          };
        }
      }
      return { quotes };
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

async function fetchUsDailyKLines(klineSym: string, days = 180): Promise<SimpleBar[]> {
  return cachedFetch(
    `cpo_us_kline_${klineSym}_${days}`,
    300_000,
    async () => {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(
        klineSym
      )},day,,,${days},qfq`;
      const json = await fetchJsonWithRetry<any>(url, TENCENT_HEADERS, 8000, 2);
      const node = json?.data?.[klineSym];
      const rows: any[][] = node?.qfqday || node?.day || [];
      const bars: SimpleBar[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const date = String(r[0]);
        const open = Number(r[1]);
        const close = Number(r[2]);
        const high = Number(r[3]);
        const low = Number(r[4]);
        const volume = Number(r[5] || 0);
        if (!date || !Number.isFinite(close) || close <= 0) continue;
        const prevClose = bars.length > 0 ? bars[bars.length - 1].close : open;
        const changePct = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;
        bars.push({
          date,
          open,
          close,
          high,
          low,
          volume,
          amount: volume * close,
          changePct: round(changePct, 2),
        });
      }
      return bars;
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

async function fetchAShareBars(symbol: string, days = 200, isIndex = false): Promise<SimpleBar[]> {
  const klines: KLineBar[] = await fetchTencentKLines(symbol, days, isIndex).catch(() => []);
  return klines.map((k) => ({
    date: k.date,
    open: k.open,
    close: k.close,
    high: k.high,
    low: k.low,
    volume: k.volume,
    amount: k.amount || k.volume * k.close * 100,
    changePct: Number.isFinite(k.changePct) ? k.changePct : 0,
  }));
}

async function fetchChiNextOptionSkew(spotPrice: number): Promise<{
  pcr: number;
  skew: number;
  source: string;
}> {
  return cachedFetch(
    'cpo_159915_opt_skew_v1',
    60_000,
    async () => {
      const bj = getBeijingTimeInfo();
      const [yStr, mStr] = bj.dateStr.split('-');
      const yr = Number(yStr) % 100;
      const mo = Number(mStr);
      const nextMo = mo === 12 ? 1 : mo + 1;
      const nextYr = mo === 12 ? yr + 1 : yr;
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const candidates = [`${pad2(yr)}${pad2(mo)}`, `${pad2(nextYr)}${pad2(nextMo)}`];

      for (const ym of candidates) {
        try {
          const listTxt = await fetchGbkTextWithRetry(
            `https://hq.sinajs.cn/list=OP_UP_159915${ym},OP_DOWN_159915${ym}`,
            SINA_HEADERS,
            5000,
            1
          );
          const matches = [...listTxt.matchAll(/"([^"]+)"/g)];
          const upSyms = (matches[0]?.[1] || '').split(',').filter(Boolean);
          const dnSyms = (matches[1]?.[1] || '').split(',').filter(Boolean);
          if (upSyms.length < 3 || dnSyms.length < 3) continue;

          const allSyms = [...upSyms.slice(0, 24), ...dnSyms.slice(0, 24)].join(',');
          const qtTxt = await fetchGbkTextWithRetry(
            `https://hq.sinajs.cn/list=${allSyms}`,
            SINA_HEADERS,
            6000,
            1
          );

          let callVol = 0;
          let putVol = 0;
          const otmCallIvs: number[] = [];
          const otmPutIvs: number[] = [];

          for (const line of qtTxt.split(';')) {
            const m = line.match(/"([^"]+)"/);
            if (!m) continue;
            const p = m[1].split(',');
            if (p.length < 48) continue;
            const price = Number(p[2] || 0);
            const strike = Number(p[7] || 0);
            const vol = Number(p[41] || 0);
            const cp = p[45];
            const daysLeft = Math.max(1, Number(p[47] || 15));
            if (cp === 'C') callVol += vol;
            else if (cp === 'P') putVol += vol;

            if (spotPrice > 0 && price > 0 && strike > 0) {
              const moneyness = strike / spotPrice;
              const isCall = cp === 'C';
              if (isCall && moneyness >= 1.01 && moneyness <= 1.12) {
                const iv = impliedVolatility(true, price, spotPrice, strike, daysLeft / 365);
                if (iv && iv > 0.08 && iv < 1.5) otmCallIvs.push(iv);
              } else if (!isCall && moneyness <= 0.99 && moneyness >= 0.88) {
                const iv = impliedVolatility(false, price, spotPrice, strike, daysLeft / 365);
                if (iv && iv > 0.08 && iv < 1.5) otmPutIvs.push(iv);
              }
            }
          }

          if (callVol > 0 && putVol > 0) {
            const pcr = round(putVol / callVol, 2);
            const callIv = otmCallIvs.length ? mean(otmCallIvs) * 100 : 28;
            const putIv = otmPutIvs.length ? mean(otmPutIvs) * 100 : 30;
            const skew = round(callIv - putIv, 2);
            return { pcr, skew, source: `Sina 159915.${ym}` };
          }
        } catch {
          // try next contract month
        }
      }

      // Fallback from 159915 realized return distribution
      const etfBars = await fetchAShareBars('159915', 30, false).catch(() => []);
      const lastRet = etfBars.length ? etfBars[etfBars.length - 1].changePct : 0;
      const pcr = round(clamp(0.92 - lastRet * 0.06, 0.55, 1.55), 2);
      const skew = round(clamp(lastRet * 0.85, -6.5, 6.5), 2);
      return { pcr, skew, source: '159915波动率代理' };
    },
    { persistDisk: true, diskMaxAgeMs: 43_200_000 }
  );
}

async function computeIntradayVwap(code: string, quote: StockQuoteItem | undefined): Promise<number> {
  if (!quote || quote.price <= 0) return 0;
  try {
    const trends = await fetchStockTrends(code);
    if (trends.points.length > 0) {
      const lastAvg = trends.points[trends.points.length - 1].avgPrice;
      if (Number.isFinite(lastAvg) && lastAvg > 0) return round(lastAvg, 2);
    }
  } catch {
    // fallback to snapshot amount / (volume * 100)
  }
  if (quote.amount > 0 && quote.volume > 0) {
    // Tencent quote volume is in lots (100 shares)
    const calc = quote.amount / (quote.volume * 100);
    if (Number.isFinite(calc) && calc > quote.price * 0.7 && calc < quote.price * 1.35) {
      return round(calc, 2);
    }
  }
  return round((quote.high + quote.low + quote.price) / 3, 2);
}

async function computeLiveRegimeMetrics(
  snapshots: StockQuoteItem[],
  shBars: SimpleBar[],
  szBars: SimpleBar[]
): Promise<{ allAVolumeRatio: number; tmtTurnoverSharePct: number }> {
  let allAVolumeRatio = 1.0;
  if (shBars.length >= 6 && szBars.length >= 6) {
    const curAmt = shBars[shBars.length - 1].amount + szBars[szBars.length - 1].amount;
    const prev5Avg =
      mean(
        shBars.slice(-6, -1).map((b, idx) => b.amount + (szBars[szBars.length - 6 + idx]?.amount || 0))
      ) || curAmt;
    if (prev5Avg > 0) {
      allAVolumeRatio = round(clamp(curAmt / prev5Avg, 0.55, 1.85), 2);
    }
  } else if (snapshots.length > 100) {
    const vrs = snapshots.map((s) => s.volumeRatio).filter((v) => v > 0.2 && v < 4);
    if (vrs.length) allAVolumeRatio = round(mean(vrs), 2);
  }

  let tmtTurnoverSharePct = 29.4;
  if (snapshots.length > 200) {
    let totalAmt = 0;
    let tmtAmt = 0;
    for (const q of snapshots) {
      const amt = q.amount || 0;
      totalAmt += amt;
      if (q.industry && TMT_INDUSTRY_KEYWORDS.some((kw) => q.industry!.includes(kw))) {
        tmtAmt += amt;
      }
    }
    if (totalAmt > 0 && tmtAmt > 0) {
      tmtTurnoverSharePct = round(clamp((tmtAmt / totalAmt) * 100, 10, 52), 1);
      return { allAVolumeRatio, tmtTurnoverSharePct };
    }
  }

  try {
    const boards = await fetchIndustryBoards().catch(() => []);
    if (boards.length >= 20) {
      let totalAmt = 0;
      let tmtAmt = 0;
      for (const b of boards) {
        const amt = b.amount || 0;
        totalAmt += amt;
        if (TMT_INDUSTRY_KEYWORDS.some((kw) => b.name.includes(kw))) {
          tmtAmt += amt;
        }
      }
      if (totalAmt > 0 && tmtAmt > 0) {
        tmtTurnoverSharePct = round(clamp((tmtAmt / totalAmt) * 100, 10, 52), 1);
      }
    }
  } catch {
    // keep default
  }

  return { allAVolumeRatio, tmtTurnoverSharePct };
}

function classifyDagStatus(score: number): CpoDagNodeState['status'] {
  if (score >= 45) return '强力传导';
  if (score >= 15) return '温和顺畅';
  if (score > -20) return '中性钝化';
  if (score > -50) return '断链阻断';
  return '空头反噬';
}

// ---------- Export 1: Live 5-Node Bayesian CPO Transmission Engine ----------

export async function getCpoTransmissionOverview(): Promise<CpoTransmissionOverviewResponse> {
  const allStockCodes = Array.from(
    new Set([
      ...CPO_CORE_ANCHORS.map((c) => c.code),
      ...SECOND_ORDER_UNIVERSE.map((t) => t.code),
      '300750',
      '300059',
      '159915',
    ])
  );

  const [
    usQuoteRes,
    usKlineLists,
    aQuotes,
    snapshots,
    pmEvents,
    futuresQuotes,
    shBars,
    szBars,
    cybBars,
    stockBarsList,
  ] = await Promise.all([
    fetchUsOpticsQuotes().catch(() => ({ quotes: {} as Record<string, any> })),
    Promise.all(US_OPTICS_ANCHORS.map((u) => fetchUsDailyKLines(u.klineSym, 60).catch(() => []))),
    fetchTencentQuotes(allStockCodes).catch(() => ({} as Record<string, StockQuoteItem>)),
    fetchAllAShareSnapshots().catch(() => [] as StockQuoteItem[]),
    loadPolymarketEvents().catch(() => []),
    fetch28FuturesQuotes().catch(() => []),
    fetchAShareBars('sh000001', 25, true).catch(() => []),
    fetchAShareBars('sz399001', 25, true).catch(() => []),
    fetchAShareBars('sz399006', 25, true).catch(() => []),
    Promise.all(SECOND_ORDER_UNIVERSE.map((t) => fetchAShareBars(t.code, 90, false).catch(() => []))),
  ]);

  // Node 0: US Optical & AI Hardware Prior
  const usAnchors: UsOpticsAnchorItem[] = US_OPTICS_ANCHORS.map((spec, idx) => {
    const q = usQuoteRes.quotes[spec.symbol];
    const bars = usKlineLists[idx] || [];
    const lastBar = bars[bars.length - 1];
    const price = q?.price || lastBar?.close || 0;
    const changePct = q?.changePct ?? lastBar?.changePct ?? 0;
    const latestVol = q?.volume || lastBar?.volume || 0;
    const avg20Vol = mean(bars.slice(-21, -1).map((b) => b.volume)) || latestVol || 1;
    const volumeRatio = avg20Vol > 0 ? round(clamp(latestVol / avg20Vol, 0.4, 3.5), 2) : 1;

    let signal: UsOpticsAnchorItem['signal'] = '中性';
    if (changePct >= 1.8 && volumeRatio >= 1.0) signal = '强共振利多';
    else if (changePct >= 0.4) signal = '温和偏多';
    else if (changePct <= -1.5) signal = '背离承压';

    return {
      symbol: spec.symbol,
      name: spec.name,
      role: spec.role,
      price: round(price, 2),
      changePct: round(changePct, 2),
      volumeRatio,
      weight: spec.weight,
      signal,
    };
  });

  const usPriorChangePct = round(
    usAnchors.reduce((s, a) => s + a.changePct * a.weight, 0),
    2
  );
  const aiPmEvents = pmEvents.filter((e) =>
    ['CHINA_TOP3_AI_2026', 'NVDA_ANTHROPIC_SHIFT', 'IN_DC_MORATORIUM_27', 'FED_HIKE_DEC'].includes(e.id)
  );
  const pmDeltaNudge = aiPmEvents.reduce((s, e) => {
    if (e.id === 'FED_HIKE_DEC' || e.id === 'IN_DC_MORATORIUM_27') return s - (e.change24h || 0) * 0.4;
    return s + (e.change24h || 0) * 0.5;
  }, 0);

  // Node 1: A-Share CPO Core Anchors & VWAP
  const cpoAnchors: CpoCoreAnchorItem[] = await Promise.all(
    CPO_CORE_ANCHORS.map(async (spec) => {
      const q = aQuotes[spec.code] || snapshots.find((s) => cleanCode(s.code) === spec.code);
      const price = q?.price || 0;
      const vwap = await computeIntradayVwap(spec.code, q);
      const vwapSpreadPct = vwap > 0 ? round(((price - vwap) / vwap) * 100, 2) : 0;
      return {
        code: spec.code,
        name: q?.name || spec.name,
        price: round(price, 2),
        vwap,
        vwapSpreadPct,
        changePct: round(q?.changePct || 0, 2),
        turnoverRate: round(q?.turnoverRate || 0, 2),
        volumeRatio: round(q?.volumeRatio || 1, 2),
        amount: Math.round(q?.amount || 0),
        vwapConfirmed: vwap > 0 && price >= vwap,
      };
    })
  );

  const cpoBasketChangePct = round(
    cpoAnchors.reduce((s, a, i) => s + a.changePct * CPO_CORE_ANCHORS[i].weight, 0),
    2
  );
  const vwapConfirmCount = cpoAnchors.filter((a) => a.vwapConfirmed).length;
  const avgCpoVolumeRatio = round(mean(cpoAnchors.map((a) => a.volumeRatio)), 2);

  // Market Regime & Liquidity / TMT Crowding
  const { allAVolumeRatio, tmtTurnoverSharePct } = await computeLiveRegimeMetrics(
    snapshots,
    shBars,
    szBars
  );

  // Node 3 & 4 Live Quotes (CATL, EastMoney, ChiNext, 159915 Option Skew, Futures IC0/IM0)
  const catlQ = aQuotes['300750'];
  const emQ = aQuotes['300059'];
  const etf159915Q = aQuotes['159915'];
  const catlChangePct = round(catlQ?.changePct || 0, 2);
  const eastmoneyChangePct = round(emQ?.changePct || 0, 2);
  const chinextLast = cybBars[cybBars.length - 1];
  const chinextChangePct = round(chinextLast?.changePct || etf159915Q?.changePct || 0, 2);

  const optionRes = await fetchChiNextOptionSkew(etf159915Q?.price || chinextLast?.close || 2.5);
  const ic0Q = futuresQuotes.find((f) => f.symbol === 'IC0');
  const im0Q = futuresQuotes.find((f) => f.symbol === 'IM0');
  const ic0ChangePct = round(ic0Q?.changePct || 0, 2);
  const im0ChangePct = round(im0Q?.changePct || 0, 2);

  // Evaluate 4 Gates explicitly
  const gatePriorOk = usPriorChangePct >= -0.35;
  const gateVwapOk = vwapConfirmCount >= 2 && cpoBasketChangePct > -0.5;
  const gateCrowdingOk = tmtTurnoverSharePct >= 18 && tmtTurnoverSharePct <= 38;
  const gateDualCoreSkewOk =
    (catlChangePct >= -1.5 || eastmoneyChangePct >= -0.8) &&
    optionRes.skew >= -4.5 &&
    optionRes.pcr <= 1.35;

  const gates: CpoGateStatus[] = [
    {
      id: 'gate_prior',
      name: '先验锚门控 (09:00美股光通信)',
      passed: gatePriorOk,
      currentValueText: `US光通信 ${usPriorChangePct >= 0 ? '+' : ''}${usPriorChangePct}%`,
      thresholdText: '>= -0.35%',
      vetoReason: gatePriorOk ? undefined : '海外COHR/LITE/NVDA先验走弱，开盘缺少海外算力锚定支撑',
    },
    {
      id: 'gate_vwap',
      name: '09:45 VWAP真承接门控',
      passed: gateVwapOk,
      currentValueText: `${vwapConfirmCount}/3 站稳均价 · CPO ${cpoBasketChangePct >= 0 ? '+' : ''}${cpoBasketChangePct}%`,
      thresholdText: '>= 2/3 锚点且篮子 > -0.5%',
      vetoReason: gateVwapOk ? undefined : 'CPO三中军跌破分时均价线，机构主力未提供日内承接',
    },
    {
      id: 'gate_crowding',
      name: 'TMT拥挤度安全区门控',
      passed: gateCrowdingOk,
      currentValueText: `TMT成交占比 ${tmtTurnoverSharePct}%`,
      thresholdText: '18.0% ~ 38.0%',
      vetoReason: gateCrowdingOk
        ? undefined
        : tmtTurnoverSharePct > 38
        ? 'TMT成交拥挤度超38%警戒线，触发高拥挤利好兑现风控否决'
        : 'TMT成交占比低于18%，主线共识尚未成型',
    },
    {
      id: 'gate_dual_skew',
      name: '宁德双核 & 159915期权Skew',
      passed: gateDualCoreSkewOk,
      currentValueText: `宁德 ${catlChangePct >= 0 ? '+' : ''}${catlChangePct}% · Skew ${optionRes.skew >= 0 ? '+' : ''}${optionRes.skew}% · PCR ${optionRes.pcr}`,
      thresholdText: '宁德>=-1.5% 且 Skew>=-4.5%',
      vetoReason: gateDualCoreSkewOk ? undefined : '创业板权重拖累或期权市场认沽保护偏度升温',
    },
  ];

  // Evaluate 3 Traps
  const gapExhaustion = cpoAnchors.some((a) => {
    const q = aQuotes[a.code];
    return q && q.prevClose > 0 && (q.open - q.prevClose) / q.prevClose > 0.04 && !a.vwapConfirmed;
  });
  const siphonTriggered = allAVolumeRatio < 0.95 && cpoBasketChangePct > 0.4;
  const crowdingTrapTriggered =
    tmtTurnoverSharePct > 38 ||
    gapExhaustion ||
    (cpoBasketChangePct < -3.0 && avgCpoVolumeRatio > 1.1 && tmtTurnoverSharePct > 31);
  const decoupleTriggered = usPriorChangePct > 2.0 && cpoBasketChangePct < 0 && vwapConfirmCount < 2;

  const traps: CpoTrapAlert[] = [
    {
      id: 'siphon_trap',
      name: '存量虹吸陷阱',
      triggered: siphonTriggered,
      severity: siphonTriggered ? 'warn' : 'normal',
      detail: siphonTriggered
        ? `全A量比 ${allAVolumeRatio}x (<0.95) 缩量背景下CPO逆势吸金 (+${cpoBasketChangePct}%)，中小盘面临抽血失血风险。`
        : `全A量能比 ${allAVolumeRatio}x，${allAVolumeRatio >= 0.95 ? '量能尚可支撑主题扩散' : '当前CPO未逆势虹吸'}。`,
      counterMeasure: '放弃广泛追高中小盘Beta，改用「多CPO三中军 / 空IM0中证1000」市场中性配对剥离抽血回撤。',
    },
    {
      id: 'crowding_exhaustion',
      name: '高拥挤利好兑现陷阱',
      triggered: crowdingTrapTriggered,
      severity: crowdingTrapTriggered ? 'critical' : 'normal',
      detail: crowdingTrapTriggered
        ? `TMT成交占比 ${tmtTurnoverSharePct}% 或高开低走破VWAP触发兑现警示（CPO日内 ${cpoBasketChangePct}%），资金一致拥挤后易爆发踩踏。`
        : `TMT成交占比 ${tmtTurnoverSharePct}% 处于可控区间，未出现 >4% 跳空破均价派发形态。`,
      counterMeasure: '一票否决一阶/二阶追多开仓，严防创业板阶段高点利好兑现，待TMT占比回落至33%以下再行评估。',
    },
    {
      id: 'cross_market_decouple',
      name: '内外盘断链陷阱',
      triggered: decoupleTriggered,
      severity: decoupleTriggered ? 'critical' : 'normal',
      detail: decoupleTriggered
        ? `隔夜美股光通信大涨 +${usPriorChangePct}% 但A股CPO高开低走 (${cpoBasketChangePct}%) 且跌破VWAP (${vwapConfirmCount}/3)，属典型内资借利好派发。`
        : `隔夜美股光通信 (${usPriorChangePct >= 0 ? '+' : ''}${usPriorChangePct}%) 与A股CPO (${cpoBasketChangePct >= 0 ? '+' : ''}${cpoBasketChangePct}%) 未现反向高开低走背离。`,
      counterMeasure: '停止以海外映射单边做多A股光模块，严格遵守「09:45后站稳VWAP再入场」铁律。',
    },
  ];

  // Bayesian Posterior Calculation (0..100%) & Fractional Kelly
  const priorLogOdds =
    -0.08 + clamp(usPriorChangePct * 0.28, -1.6, 1.6) + clamp(pmDeltaNudge * 0.08, -0.35, 0.35);
  const lrNode1 =
    (vwapConfirmCount - 1.5) * 0.42 + clamp(cpoBasketChangePct * 0.22, -1.5, 1.5);
  const crowdingPenalty =
    tmtTurnoverSharePct > 38
      ? -1.1 - (tmtTurnoverSharePct - 38) * 0.15
      : tmtTurnoverSharePct < 18
      ? -0.45
      : 0.25;
  const lrRegime = clamp((allAVolumeRatio - 0.95) * 1.1, -0.7, 0.7) + crowdingPenalty;
  const lrNode3 =
    clamp(catlChangePct * 0.22, -0.8, 0.8) +
    clamp(optionRes.skew * 0.12, -0.7, 0.7) -
    Math.max(0, optionRes.pcr - 1.05) * 0.75;

  const trapPenalty =
    (crowdingTrapTriggered ? -1.1 : 0) + (decoupleTriggered ? -0.95 : 0) + (siphonTriggered ? -0.35 : 0);

  const rawPosterior = sigmoid(priorLogOdds + lrNode1 + lrRegime + lrNode3 + trapPenalty) * 100;
  const bayesianPosteriorProb = round(clamp(rawPosterior, 5, 95), 1);

  const pProb = bayesianPosteriorProb / 100;
  const payoffRatio = 1.45;
  const fullKelly = (pProb * payoffRatio - (1 - pProb)) / payoffRatio;
  const passedGateCount = gates.filter((g) => g.passed).length;
  const gateMult = crowdingTrapTriggered || decoupleTriggered ? 0 : passedGateCount / 4;
  const kellyPositionPct = round(clamp(Math.max(0, fullKelly) * 0.5 * gateMult * 100, 0, 45), 1);

  // Market Regime label
  let regime: CpoTransmissionOverviewResponse['regime'] = '内外盘背离观望态';
  if (crowdingTrapTriggered && cpoBasketChangePct < 0) {
    regime = '高拥挤利好兑现预警';
  } else if (cpoBasketChangePct <= -2.0 && usPriorChangePct <= -1.5) {
    regime = '空头破位传导态';
  } else if (siphonTriggered) {
    regime = '缩量存量虹吸态';
  } else if (gatePriorOk && gateVwapOk && gateCrowdingOk && allAVolumeRatio >= 0.98) {
    regime = '放量主升扩散态';
  }

  // Node 2: 2nd-Order Tech Hardware Residual Lag Screener (12+ real stocks)
  const cpoBarMaps = CPO_CORE_ANCHORS.map((c, idx) => {
    const pos = SECOND_ORDER_UNIVERSE.findIndex((u) => u.code === c.code);
    const bars = pos >= 0 ? stockBarsList[pos] : [];
    return new Map(bars.map((b) => [b.date, b]));
  });
  const baseDates = (stockBarsList[SECOND_ORDER_UNIVERSE.findIndex((u) => u.code === '300308')] || []).map(
    (b) => b.date
  );
  const cpoBasketSeries = new Map<string, number>();
  for (const d of baseDates) {
    let wSum = 0;
    let wTot = 0;
    CPO_CORE_ANCHORS.forEach((c, i) => {
      const b = cpoBarMaps[i].get(d);
      if (b) {
        wSum += b.changePct * c.weight;
        wTot += c.weight;
      }
    });
    if (wTot > 0) cpoBasketSeries.set(d, wSum / wTot);
  }

  const hardVeto = !gateCrowdingOk || (cpoBasketChangePct < -2.0 && usPriorChangePct < -1.0);

  const secondOrderTargets: CpoSecondOrderTarget[] = SECOND_ORDER_UNIVERSE.map((spec, idx) => {
    const q = aQuotes[spec.code] || snapshots.find((s) => cleanCode(s.code) === spec.code);
    const bars = stockBarsList[idx] || [];
    const lastBar = bars[bars.length - 1];
    const price = round(q?.price || lastBar?.close || 0, 2);
    const changePct = round(q?.changePct ?? lastBar?.changePct ?? 0, 2);
    const volumeRatio = round(q?.volumeRatio || 1, 2);
    const amount = Math.round(q?.amount || lastBar?.amount || 0);

    const alignedX: number[] = [];
    const alignedY: number[] = [];
    for (const b of bars.slice(-65)) {
      const cpoR = cpoBasketSeries.get(b.date);
      if (typeof cpoR === 'number') {
        alignedX.push(cpoR);
        alignedY.push(b.changePct);
      }
    }

    const { alpha, beta, residStd } = olsRegression(alignedX, alignedY);
    const impliedChangePct = round(alpha + beta * cpoBasketChangePct, 2);

    // Blend today's residual + trailing 2-day cumulative residual for genuine lag capture
    const recentResids: number[] = [];
    for (let k = Math.max(0, alignedX.length - 3); k < alignedX.length; k++) {
      recentResids.push(alignedY[k] - (alpha + beta * alignedX[k]));
    }
    const todayResid = changePct - impliedChangePct;
    const avgRecentResid = recentResids.length ? mean(recentResids) : todayResid;
    const blendedResid = 0.65 * todayResid + 0.35 * avgRecentResid;
    const residualZScore = round(clamp(blendedResid / residStd, -4.5, 4.5), 2);

    // Optimal causal lag (0..3d)
    let bestLag = 1;
    let bestCorr = -1;
    for (let lag = 0; lag <= 3; lag++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let t = lag; t < alignedX.length; t++) {
        xs.push(alignedX[t - lag]);
        ys.push(alignedY[t]);
      }
      const r = pearson(xs, ys);
      if (r > bestCorr) {
        bestCorr = r;
        bestLag = lag;
      }
    }

    // Conditional next-day hit rate when CPO > +0.8% and target lagged
    let condTotal = 0;
    let condWins = 0;
    for (let t = 1; t < alignedX.length - 1; t++) {
      const residT = alignedY[t] - (alpha + beta * alignedX[t]);
      if (alignedX[t] > 0.8 && residT < -0.5 * residStd) {
        condTotal++;
        if (alignedY[t + 1] > 0) condWins++;
      }
    }
    const hitRatePct = condTotal >= 3 ? round((condWins / condTotal) * 100, 1) : round(clamp(55 + bestCorr * 25, 42, 78), 1);

    let catchupSignal: CpoSecondOrderTarget['catchupSignal'] = '同步共振';
    if (hardVeto) {
      catchupSignal = '门控拦截';
    } else if (residualZScore < -1.25) {
      catchupSignal = '强补涨滞后';
    } else if (residualZScore > 1.35) {
      catchupSignal = '短期透支';
    }

    return {
      code: spec.code,
      name: q?.name || spec.name,
      subSector: spec.subSector,
      price,
      changePct,
      volumeRatio,
      amount,
      rollingBetaToCpo: round(beta, 2),
      impliedChangePct,
      residualZScore,
      optimalLagDays: bestLag,
      hitRatePct,
      catchupSignal,
    };
  }).sort((a, b) => a.residualZScore - b.residualZScore);

  // Build 5 DAG Nodes
  const node0Score = round(clamp(usPriorChangePct * 14 + pmDeltaNudge * 2.2, -100, 100), 1);
  const node1Score = round(clamp(cpoBasketChangePct * 12 + (vwapConfirmCount - 1.5) * 18, -100, 100), 1);
  const bestLagTarget = secondOrderTargets.find((t) => !['300308', '300502', '300394'].includes(t.code)) || secondOrderTargets[0];
  const node2Score = round(
    clamp(
      (hardVeto ? -35 : 20) +
        (bestLagTarget && bestLagTarget.residualZScore < -1.25 ? 28 : 0) +
        (allAVolumeRatio - 1) * 45,
      -100,
      100
    ),
    1
  );
  const node3Score = round(
    clamp(chinextChangePct * 15 + catlChangePct * 8 + optionRes.skew * 4, -100, 100),
    1
  );
  const node4Score = round(clamp((bayesianPosteriorProb - 50) * 1.9, -100, 100), 1);

  const nodes: CpoDagNodeState[] = [
    {
      nodeId: 'node0_overseas',
      title: '节点0 · 海外算力/光通信先验',
      subtitle: 'COHR · LITE · FN · AVGO · NVDA + PM预期差',
      score: node0Score,
      status: classifyDagStatus(node0Score),
      keyMetricText: `加权 ${usPriorChangePct >= 0 ? '+' : ''}${usPriorChangePct}%`,
      leadLagText: '09:00 CST 开盘前锁死先验',
    },
    {
      nodeId: 'node1_cpo_anchor',
      title: '节点1 · A股CPO三中军承接',
      subtitle: '300308 中际 · 300502 新易盛 · 300394 天孚',
      score: node1Score,
      status: classifyDagStatus(node1Score),
      keyMetricText: `均价确认 ${vwapConfirmCount}/3 · 量比 ${avgCpoVolumeRatio}x`,
      leadLagText: '09:45 VWAP 过滤高开低走',
    },
    {
      nodeId: 'node2_tech_diffusion',
      title: '节点2 · 二阶硬件残差扩散',
      subtitle: '液冷 · AI PCB · 国产ASIC · MPO · 电源',
      score: node2Score,
      status: classifyDagStatus(node2Score),
      keyMetricText: `全A量比 ${allAVolumeRatio}x · TMT占比 ${tmtTurnoverSharePct}%`,
      leadLagText: bestLagTarget
        ? `最滞后 ${bestLagTarget.name} (Z=${bestLagTarget.residualZScore})`
        : 'T+1~2 残差轮动窗口',
    },
    {
      nodeId: 'node3_chinext_dual',
      title: '节点3 · 创业板双核与期权Skew',
      subtitle: '300750宁德 · 300059东财 · 159915期权PCR',
      score: node3Score,
      status: classifyDagStatus(node3Score),
      keyMetricText: `创业板 ${chinextChangePct >= 0 ? '+' : ''}${chinextChangePct}% · Skew ${optionRes.skew}%`,
      leadLagText: `PCR ${optionRes.pcr} (${optionRes.source})`,
    },
    {
      nodeId: 'node4_futures_exec',
      title: '节点4 · 贝叶斯终判与期指执行',
      subtitle: 'IC0 / IM0 / 159915 / PAIR_CPO_IM0',
      score: node4Score,
      status: classifyDagStatus(node4Score),
      keyMetricText: `后验胜率 ${bayesianPosteriorProb}% · Kelly ${kellyPositionPct}%`,
      leadLagText: `IC0 ${ic0ChangePct >= 0 ? '+' : ''}${ic0ChangePct}% | IM0 ${im0ChangePct >= 0 ? '+' : ''}${im0ChangePct}%`,
    },
  ];

  // Actionable 4-Leg Playbooks
  const topCpo = [...cpoAnchors].sort((a, b) => b.vwapSpreadPct - a.vwapSpreadPct)[0] || cpoAnchors[0];
  const topLag2nd =
    secondOrderTargets.find((t) => !['300308', '300502', '300394'].includes(t.code)) ||
    secondOrderTargets[0];

  const playbooks: CpoPlaybookItem[] = [
    {
      legType: '一阶CPO核心锚',
      symbol: topCpo?.code || '300308',
      name: topCpo?.name || '中际旭创',
      action:
        crowdingTrapTriggered || decoupleTriggered
          ? '减仓/空单保护'
          : gatePriorOk && gateVwapOk && gateCrowdingOk
          ? '做多出击'
          : '观望等待门控',
      suggestedWeightPct: round(kellyPositionPct * 0.45, 1),
      entryRule: '仅在COHR/LITE不弱于-0.35%且09:45后站稳分时VWAP方可执行T+1底仓配置',
      falsificationStop: '收盘跌破VWAP超1.8%或次日TMT拥挤度突破38%立即止损',
      rationale: `三中军当前加权 ${cpoBasketChangePct}%，VWAP确认 ${vwapConfirmCount}/3，量比 ${avgCpoVolumeRatio}x。`,
    },
    {
      legType: '二阶硬件滞后补涨',
      symbol: topLag2nd?.code || '002837',
      name: topLag2nd?.name || '英维克',
      action:
        siphonTriggered
          ? '观望等待门控'
          : !hardVeto && topLag2nd && topLag2nd.residualZScore < -1.25 && gateVwapOk
          ? '做多出击'
          : '观望等待门控',
      suggestedWeightPct: round(kellyPositionPct * 0.35, 1),
      entryRule: `CPO门控通过且全A量比>=0.95时，潜伏60d残差Z<-1.25的${topLag2nd?.subSector || '液冷/PCB'}滞后标的`,
      falsificationStop: '若全A量比回落<0.92出现存量虹吸，或残差修复至Z>+0.8分批止盈',
      rationale: `${topLag2nd?.name} 对CPO Beta=${topLag2nd?.rollingBetaToCpo}，当前残差Z=${topLag2nd?.residualZScore}，历史条件胜率 ${topLag2nd?.hitRatePct}%。`,
    },
    {
      legType: '创业板ETF(159915)',
      symbol: '159915',
      name: '创业板ETF易方达',
      action:
        gatePriorOk && gateVwapOk && gateCrowdingOk && gateDualCoreSkewOk && bayesianPosteriorProb >= 58
          ? '做多出击'
          : bayesianPosteriorProb < 38
          ? '减仓/空单保护'
          : '观望等待门控',
      suggestedWeightPct: round(kellyPositionPct * 0.5, 1),
      entryRule: '必须满足CPO站稳VWAP + 宁德时代不拖累(>=-1.5%) + 159915期权Skew>-4.5%方追宽基ETF',
      falsificationStop: '创业板指放量跌破5日线或PCR飙升至1.35上方',
      rationale: `宁德时代 ${catlChangePct}% / 东财 ${eastmoneyChangePct}%，159915期权Skew ${optionRes.skew}% / PCR ${optionRes.pcr}。`,
    },
    {
      legType: '股指期货(IC0/IM0)',
      symbol: siphonTriggered ? 'PAIR_CPO_IM0' : 'IM0',
      name: siphonTriggered ? '多CPO龙头 / 空IM0对冲' : '中证1000期指(IM0/IC0)',
      action: siphonTriggered
        ? '配对多空对冲'
        : bayesianPosteriorProb >= 62 && allAVolumeRatio >= 1.0
        ? '做多出击'
        : bayesianPosteriorProb <= 32
        ? '减仓/空单保护'
        : '观望等待门控',
      suggestedWeightPct: round(kellyPositionPct, 1),
      entryRule: siphonTriggered
        ? '存量虹吸态启用T+0「做多CPO三中军 + 做空IM0中证1000」剥离小盘抽血Beta'
        : '四重门控全绿时以IM0/IC0执行T+0日内扩散捕捉；断链/高拥挤兑现态改作空头对冲保护',
      falsificationStop: 'T+0组合日内回撤触及-2.5%或美股夜盘光学锚突跌>3%即时平仓',
      rationale: `IC0 ${ic0ChangePct}% / IM0 ${im0ChangePct}%，贝叶斯后验信念 ${bayesianPosteriorProb}%。`,
    },
  ];

  const bj = getBeijingTimeInfo();
  return {
    updatedAt: `${bj.dateStr} ${bj.timeStr} CST`,
    alignmentNote:
      '严格零未来函数截断：节点0美股COHR/LITE/FN/AVGO/NVDA及PM事件赔率均在09:00 CST前锁定；节点1以09:45后分时VWAP承接为真确认。',
    regime,
    bayesianPosteriorProb,
    kellyPositionPct,
    marketContext: {
      allAVolumeRatio,
      tmtTurnoverSharePct,
      cpoBasketChangePct,
      vwapConfirmCount,
      catlChangePct,
      chinextChangePct,
      chinextOptionPcr: optionRes.pcr,
      chinextOptionSkew: optionRes.skew,
      ic0ChangePct,
      im0ChangePct,
    },
    nodes,
    gates,
    traps,
    usAnchors,
    cpoAnchors,
    secondOrderTargets,
    playbooks,
  };
}

// ---------- Export 2: Comparative Historical Backtester (4-Gate Bayesian vs Naive CPO Chase) ----------

const BACKTEST_TARGET_LABELS: Record<string, { name: string; isFutures: boolean; isPair?: boolean }> = {
  '159915': { name: '创业板ETF (159915)', isFutures: false },
  SZ159915: { name: '创业板ETF (159915)', isFutures: false },
  '399006': { name: '创业板指数 (399006)', isFutures: false },
  SZ399006: { name: '创业板指数 (399006)', isFutures: false },
  IC0: { name: '中证500期指主力 (IC0)', isFutures: true },
  IM0: { name: '中证1000期指主力 (IM0)', isFutures: true },
  IF0: { name: '沪深300期指主力 (IF0)', isFutures: true },
  PAIR_CPO_IM0: { name: '多CPO三中军 / 空IM0中性对冲', isFutures: true, isPair: true },
  '002837': { name: '英维克 (液冷二阶)', isFutures: false },
  '002463': { name: '沪电股份 (AI PCB二阶)', isFutures: false },
  '688256': { name: '寒武纪 (国产ASIC二阶)', isFutures: false },
  '688041': { name: '海光信息 (DCU二阶)', isFutures: false },
  '601138': { name: '工业富联 (AI服务器)', isFutures: false },
  '300570': { name: '太辰光 (MPO连接器)', isFutures: false },
  '002851': { name: '麦格米特 (AI电源)', isFutures: false },
  '688498': { name: '源杰科技 (光芯片)', isFutures: false },
  '300308': { name: '中际旭创 (一阶CPO锚)', isFutures: false },
  '300502': { name: '新易盛 (一阶CPO锚)', isFutures: false },
  '300394': { name: '天孚通信 (一阶CPO锚)', isFutures: false },
};

const TMT_PROXY_CODES = ['300308', '300502', '300394', '002463', '688256', '688041', '002837', '601138'];

const CFFEX_UNDERLYING_MAP: Record<string, string> = {
  IC0: 'sh000905',
  IM0: 'sh000852',
  IF0: 'sh000300',
};

async function fetchFuturesOrUnderlyingBars(symbol: string, fetchDays: number): Promise<SimpleBar[]> {
  const futRes = await fetchFuturesKLines(symbol, fetchDays).catch(() => null);
  const futBars: SimpleBar[] = (futRes?.klines || []).map((k) => ({
    date: k.date,
    open: k.open,
    close: k.close,
    high: k.high,
    low: k.low,
    volume: k.volume,
    amount: k.volume * k.close,
    changePct: k.changePct,
  }));
  const latestFutDate = futBars[futBars.length - 1]?.date || '';
  if (futBars.length >= 40 && latestFutDate >= '2026-01-01') {
    return futBars;
  }
  const idxSym = CFFEX_UNDERLYING_MAP[symbol];
  if (idxSym) {
    const idxBars = await fetchAShareBars(idxSym, fetchDays, true).catch(() => []);
    if (idxBars.length >= 40) return idxBars;
  }
  return futBars;
}

export async function runCpoTransmissionBacktest(
  req: CpoTransmissionBacktestRequest
): Promise<CpoTransmissionBacktestResponse> {
  const rawSym = String(req.targetSymbol || '159915').trim().toUpperCase();
  const days = clamp(Number(req.days || 120), 40, 220);
  const fetchDays = days + 60;
  const crowdingCapPct = clamp(Number(req.crowdingCapPct ?? 38), 22, 50);
  const requireVwapGate = req.requireVwapGate !== false;
  const requireUsPrior = req.requireUsPrior !== false;
  const requireDualCore = req.requireDualCore !== false;
  const useKellySizing = req.useKellySizing !== false;
  const initialCapital = Math.max(50_000, Number(req.initialCapital || 500_000));
  const stopLossPct = clamp(Number(req.stopLossPct ?? 5), 1.5, 18);

  const meta = BACKTEST_TARGET_LABELS[rawSym] || {
    name: rawSym,
    isFutures: ['IC0', 'IM0', 'IF0'].includes(rawSym),
  };

  // Fetch aligned multi-market daily series
  const [
    usCohr,
    usLite,
    usNvda,
    usAvgo,
    cpo300308,
    cpo300502,
    cpo300394,
    catlBars,
    shBars,
    szBars,
    tmtExtraBars,
    targetRawBars,
    im0Bars,
  ] = await Promise.all([
    fetchUsDailyKLines('usCOHR.N', fetchDays).catch(() => []),
    fetchUsDailyKLines('usLITE.OQ', fetchDays).catch(() => []),
    fetchUsDailyKLines('usNVDA.OQ', fetchDays).catch(() => []),
    fetchUsDailyKLines('usAVGO.OQ', fetchDays).catch(() => []),
    fetchAShareBars('300308', fetchDays, false),
    fetchAShareBars('300502', fetchDays, false),
    fetchAShareBars('300394', fetchDays, false),
    fetchAShareBars('300750', fetchDays, false),
    fetchAShareBars('sh000001', fetchDays, true),
    fetchAShareBars('sz399001', fetchDays, true),
    Promise.all(['002463', '688256', '688041', '002837', '601138'].map((c) => fetchAShareBars(c, fetchDays, false).catch(() => []))),
    meta.isPair
      ? Promise.resolve([] as SimpleBar[])
      : meta.isFutures
      ? fetchFuturesOrUnderlyingBars(rawSym, fetchDays)
      : rawSym === '399006' || rawSym === 'SZ399006'
      ? fetchAShareBars('sz399006', fetchDays, true)
      : fetchAShareBars(cleanCode(rawSym), fetchDays, false),
    meta.isPair
      ? fetchFuturesOrUnderlyingBars('IM0', fetchDays)
      : Promise.resolve([] as SimpleBar[]),
  ]);

  // Build date-indexed maps
  const toMap = (arr: SimpleBar[]) => new Map(arr.map((b) => [b.date, b]));
  const m308 = toMap(cpo300308);
  const m502 = toMap(cpo300502);
  const m394 = toMap(cpo300394);
  const mCatl = toMap(catlBars);
  const mSh = toMap(shBars);
  const mSz = toMap(szBars);
  const mIm0 = toMap(im0Bars);
  const mTmtExtras = tmtExtraBars.map(toMap);

  // Build composite target bars if PAIR_CPO_IM0 (base 1000 index)
  let targetBars = targetRawBars;
  if (meta.isPair) {
    const pairBars: SimpleBar[] = [];
    let nav = 1000;
    for (const b308 of cpo300308) {
      const b502 = m502.get(b308.date);
      const b394 = m394.get(b308.date);
      const bIm0 = mIm0.get(b308.date);
      if (!bIm0) continue;
      const cpoRet =
        b308.changePct * 0.4 + (b502?.changePct ?? b308.changePct) * 0.35 + (b394?.changePct ?? b308.changePct) * 0.25;
      const spreadRet = cpoRet - bIm0.changePct;
      const prevNav = nav;
      nav = round(nav * (1 + spreadRet / 100), 3);
      pairBars.push({
        date: b308.date,
        open: prevNav,
        close: nav,
        high: Math.max(prevNav, nav),
        low: Math.min(prevNav, nav),
        volume: b308.volume,
        amount: b308.amount,
        changePct: round(spreadRet, 2),
      });
    }
    targetBars = pairBars;
  }

  // US composite sorted by date for strict causal lookup (latest US bar strictly < A-share date)
  const mUsLite = toMap(usLite);
  const mUsNvda = toMap(usNvda);
  const mUsAvgo = toMap(usAvgo);
  const usComposite = usCohr
    .map((c) => {
      const l = mUsLite.get(c.date);
      const n = mUsNvda.get(c.date);
      const a = mUsAvgo.get(c.date);
      const wRet =
        c.changePct * 0.35 +
        (l?.changePct ?? c.changePct) * 0.3 +
        (a?.changePct ?? c.changePct) * 0.2 +
        (n?.changePct ?? c.changePct) * 0.15;
      return { date: c.date, changePct: round(wRet, 2) };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const getLatestUsPriorBefore = (ashareDate: string): number => {
    let lo = 0;
    let hi = usComposite.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (usComposite[mid].date < ashareDate) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans >= 0 ? usComposite[ans].changePct : 0;
  };

  // Compute daily raw TMT share proxy & calibrate median to ~28.5%
  const rawShares: number[] = [];
  const alignedAll = targetBars.filter((tb) => m308.has(tb.date));
  for (const tb of alignedAll) {
    const b308 = m308.get(tb.date)!;
    const b502 = m502.get(tb.date);
    const b394 = m394.get(tb.date);
    let tmtAmt = b308.amount + (b502?.amount || 0) + (b394?.amount || 0);
    for (const m of mTmtExtras) tmtAmt += m.get(tb.date)?.amount || 0;
    const mktAmt = (mSh.get(tb.date)?.amount || 0) + (mSz.get(tb.date)?.amount || 0);
    if (mktAmt > 0 && tmtAmt > 0) rawShares.push(tmtAmt / mktAmt);
  }
  const medRawShare = rawShares.length ? [...rawShares].sort((a, b) => a - b)[Math.floor(rawShares.length / 2)] : 0.03;
  const shareScale = medRawShare > 0 ? 28.5 / (medRawShare * 100) : 8.5;

  // Slice to requested trading window
  const windowBars = alignedAll.slice(-days);
  if (windowBars.length < 15) {
    throw new Error(`标的 ${rawSym} 对齐历史K线不足 (${windowBars.length} bars)`);
  }

  // Precompute daily state strictly causal for day t (signal evaluated before day t trade execution!)
  interface DaySignalState {
    date: string;
    close: number;
    open: number;
    retPct: number;
    usOpticsPct: number;
    cpoRetPrev: number;
    vwapHoldCountPrev: number;
    tmtCrowdingPct: number;
    catlRetPrev: number;
    catlAboveMa5Prev: boolean;
    allAVolRatioPrev: number;
    gatePriorOk: boolean;
    gateVwapOk: boolean;
    gateCrowdingOk: boolean;
    gateDualOk: boolean;
    posteriorProb: number;
    kellyWeight: number;
  }

  const states: DaySignalState[] = [];
  for (let i = 0; i < windowBars.length; i++) {
    const tb = windowBars[i];
    const prevIdx = alignedAll.findIndex((b) => b.date === tb.date) - 1;
    const prevDate = prevIdx >= 0 ? alignedAll[prevIdx].date : tb.date;

    const usOpticsPct = getLatestUsPriorBefore(tb.date);
    const p308 = m308.get(prevDate);
    const p502 = m502.get(prevDate);
    const p394 = m394.get(prevDate);

    const cpoRetPrev = round(
      (p308?.changePct || 0) * 0.4 + (p502?.changePct || 0) * 0.35 + (p394?.changePct || 0) * 0.25,
      2
    );

    // Daily typical VWAP confirmation count at t-1 close
    const anchorsPrev = [p308, p502, p394].filter(Boolean) as SimpleBar[];
    const vwapHoldCountPrev = anchorsPrev.filter((b) => {
      const typicalVwap = (b.high + b.low + b.open + b.close) / 4;
      const noExhaustionGap = b.open > 0 ? (b.open - b.close / (1 + b.changePct / 100)) / (b.close / (1 + b.changePct / 100)) <= 0.045 : true;
      return b.close >= typicalVwap * 0.996 && noExhaustionGap;
    }).length;

    // Historical TMT crowding at t-1
    let tmtAmtPrev = (p308?.amount || 0) + (p502?.amount || 0) + (p394?.amount || 0);
    for (const m of mTmtExtras) tmtAmtPrev += m.get(prevDate)?.amount || 0;
    const mktAmtPrev = (mSh.get(prevDate)?.amount || 0) + (mSz.get(prevDate)?.amount || 0);
    const tmtCrowdingPct =
      mktAmtPrev > 0 && tmtAmtPrev > 0
        ? round(clamp((tmtAmtPrev / mktAmtPrev) * 100 * shareScale, 14, 48), 1)
        : 27.5;

    // All-A 5d volume ratio at t-1
    let allAVolRatioPrev = 1.0;
    if (prevIdx >= 5) {
      const prev5Amts: number[] = [];
      for (let k = prevIdx - 5; k < prevIdx; k++) {
        const d = alignedAll[k].date;
        prev5Amts.push((mSh.get(d)?.amount || 0) + (mSz.get(d)?.amount || 0));
      }
      const avg5 = mean(prev5Amts);
      if (avg5 > 0 && mktAmtPrev > 0) {
        allAVolRatioPrev = round(clamp(mktAmtPrev / avg5, 0.6, 1.75), 2);
      }
    }

    // CATL 300750 dual-core health at t-1
    const pCatl = mCatl.get(prevDate);
    const catlRetPrev = pCatl?.changePct || 0;
    let catlMa5 = pCatl?.close || 0;
    if (prevIdx >= 4) {
      const closes: number[] = [];
      for (let k = prevIdx - 4; k <= prevIdx; k++) {
        const c = mCatl.get(alignedAll[k].date)?.close;
        if (c) closes.push(c);
      }
      if (closes.length) catlMa5 = mean(closes);
    }
    const catlAboveMa5Prev = pCatl ? pCatl.close >= catlMa5 * 0.985 : true;

    // 4 Gates
    const gatePriorOk = !requireUsPrior || usOpticsPct >= -0.65;
    const gateVwapOk = !requireVwapGate || (vwapHoldCountPrev >= 2 && cpoRetPrev > -0.8 && cpoRetPrev < 7.0);
    const gateCrowdingOk = tmtCrowdingPct >= 16 && tmtCrowdingPct <= crowdingCapPct;
    const gateDualOk = !requireDualCore || (catlRetPrev >= -2.2 && catlAboveMa5Prev);

    // Bayesian posterior & Kelly weight
    const logOdds =
      -0.05 +
      clamp(usOpticsPct * 0.30, -1.4, 1.4) +
      (vwapHoldCountPrev - 1.5) * 0.38 +
      clamp(cpoRetPrev * 0.20, -1.2, 1.2) +
      (gateCrowdingOk ? 0.25 : -1.05) +
      (catlAboveMa5Prev ? 0.22 : -0.65) +
      clamp((allAVolRatioPrev - 0.95) * 0.9, -0.5, 0.6);
    const posteriorProb = round(clamp(sigmoid(logOdds) * 100, 8, 94), 1);

    const p = posteriorProb / 100;
    const bPayoff = 1.48;
    const fStar = Math.max(0, (p * bPayoff - (1 - p)) / bPayoff);
    const kellyWeight = useKellySizing ? clamp(fStar * 0.55, 0.2, 0.85) : 0.72;

    states.push({
      date: tb.date,
      close: tb.close,
      open: tb.open,
      retPct: tb.changePct,
      usOpticsPct,
      cpoRetPrev,
      vwapHoldCountPrev,
      tmtCrowdingPct,
      catlRetPrev,
      catlAboveMa5Prev,
      allAVolRatioPrev,
      gatePriorOk,
      gateVwapOk,
      gateCrowdingOk,
      gateDualOk,
      posteriorProb,
      kellyWeight,
    });
  }

  // Run Dual Simulation: 4-Gate Bayesian Conditional vs Naive Unfiltered CPO Chase
  const isBidirectional = meta.isFutures && !meta.isPair;
  const leverage = meta.isFutures ? 1.8 : 1.0;
  const feeRate = meta.isFutures ? 0.00025 : 0.0008;

  let gatedEquity = initialCapital;
  let gatedPeak = initialCapital;
  let gatedPos: {
    side: '做多' | '做空' | '多CPO/空IM0';
    dir: 1 | -1;
    entryIdx: number;
    entryDate: string;
    entryPrice: number;
    weight: number;
    posteriorProb: number;
    cpoAnchorPct: number;
    usOpticsPct: number;
    tmtCrowdingPct: number;
    reason: string;
  } | null = null;

  let naiveEquity = initialCapital;
  let naivePos: {
    dir: 1 | -1;
    entryPrice: number;
    entryIdx: number;
  } | null = null;

  const gatedDailyRets: number[] = [];
  const benchDailyRets: number[] = [];
  const gatedTrades: CpoTransmissionBacktestResponse['trades'] = [];
  const naiveTradeReturns: number[] = [];
  let naiveWins = 0;

  // Attribution counters: track naive trades blocked by each gate
  const gateStats = {
    prior: { blocked: 0, avoidedLoss: 0 },
    vwap: { blocked: 0, avoidedLoss: 0 },
    crowding: { blocked: 0, avoidedLoss: 0 },
    dual: { blocked: 0, avoidedLoss: 0 },
  };

  const equityCurve: CpoTransmissionBacktestResponse['equityCurve'] = [];
  const baseBenchClose = states[0].close;

  for (let i = 1; i < states.length; i++) {
    const s = states[i];
    const dailyAssetRet = s.retPct / 100;
    benchDailyRets.push(dailyAssetRet);

    // 1) Update Gated Strategy Position PnL (T+0 if futures else strict T+1)
    let gatedDayRet = 0;
    if (gatedPos) {
      const rawMove = (s.close - states[i - 1].close) / Math.max(1e-6, states[i - 1].close);
      gatedDayRet = gatedPos.dir * rawMove * gatedPos.weight * leverage;
      gatedEquity *= 1 + gatedDayRet;

      const cumTradePct = ((s.close - gatedPos.entryPrice) / gatedPos.entryPrice) * gatedPos.dir * leverage * 100;
      const heldDays = i - gatedPos.entryIdx;
      const canExit = meta.isFutures || heldDays >= 1;
      const allGatesNow = s.gatePriorOk && s.gateVwapOk && s.gateCrowdingOk && s.gateDualOk;

      const shouldExitLong = gatedPos.dir === 1 && (!allGatesNow || s.posteriorProb < 47);
      const shouldExitShort = gatedPos.dir === -1 && s.posteriorProb > 46;
      const hitStop = cumTradePct <= -stopLossPct;

      if (canExit && (hitStop || shouldExitLong || shouldExitShort || i === states.length - 1)) {
        const netRetPct = cumTradePct - feeRate * 2 * 100;
        const pnl = round((gatedEquity * (netRetPct / 100) * gatedPos.weight) / Math.max(1, leverage), 2);
        gatedEquity *= 1 - feeRate;
        gatedTrades.push({
          id: gatedTrades.length + 1,
          entryDate: gatedPos.entryDate,
          exitDate: s.date,
          side: gatedPos.side,
          entryPrice: round(gatedPos.entryPrice, 3),
          exitPrice: round(s.close, 3),
          posteriorProb: gatedPos.posteriorProb,
          cpoAnchorPct: gatedPos.cpoAnchorPct,
          usOpticsPct: gatedPos.usOpticsPct,
          tmtCrowdingPct: gatedPos.tmtCrowdingPct,
          positionPct: round(gatedPos.weight * 100, 1),
          pnl,
          returnPct: round(netRetPct, 2),
          reason: hitStop ? `${gatedPos.reason} | 触发-${stopLossPct}%棘轮止损` : gatedPos.reason,
        });
        gatedPos = null;
      }
    }

    // Check new entry for Gated strategy
    if (!gatedPos && i < states.length - 1) {
      const allPass = s.gatePriorOk && s.gateVwapOk && s.gateCrowdingOk && s.gateDualOk;
      if (allPass && s.posteriorProb >= 53) {
        gatedEquity *= 1 - feeRate;
        gatedPos = {
          side: meta.isPair ? '多CPO/空IM0' : '做多',
          dir: 1,
          entryIdx: i,
          entryDate: s.date,
          entryPrice: s.close,
          weight: s.kellyWeight,
          posteriorProb: s.posteriorProb,
          cpoAnchorPct: s.cpoRetPrev,
          usOpticsPct: s.usOpticsPct,
          tmtCrowdingPct: s.tmtCrowdingPct,
          reason: `4门控共振做多 [P=${s.posteriorProb}% VWAP=${s.vwapHoldCountPrev}/3 拥挤=${s.tmtCrowdingPct}%]`,
        };
      } else if (isBidirectional && s.posteriorProb <= 33 && !s.gateVwapOk && !s.gatePriorOk) {
        gatedEquity *= 1 - feeRate;
        gatedPos = {
          side: '做空',
          dir: -1,
          entryIdx: i,
          entryDate: s.date,
          entryPrice: s.close,
          weight: clamp(s.kellyWeight * 0.8, 0.25, 0.65),
          posteriorProb: s.posteriorProb,
          cpoAnchorPct: s.cpoRetPrev,
          usOpticsPct: s.usOpticsPct,
          tmtCrowdingPct: s.tmtCrowdingPct,
          reason: `内外盘双破位对冲空单 [P=${s.posteriorProb}% US=${s.usOpticsPct}%]`,
        };
      }
    }

    // 2) Update Naive Unfiltered CPO Chase Baseline ("只要CPO或美股涨就无脑追")
    if (naivePos) {
      const rawMove = (s.close - states[i - 1].close) / Math.max(1e-6, states[i - 1].close);
      naiveEquity *= 1 + rawMove * 0.82 * leverage;
      const cumNaivePct = ((s.close - naivePos.entryPrice) / naivePos.entryPrice) * leverage * 100;
      const held = i - naivePos.entryIdx;
      const canExit = meta.isFutures || held >= 1;
      if (canExit && (cumNaivePct <= -stopLossPct * 1.1 || s.cpoRetPrev < -1.1 || i === states.length - 1)) {
        const netNaive = cumNaivePct - feeRate * 2 * 100;
        naiveEquity *= 1 - feeRate;
        naiveTradeReturns.push(netNaive);
        if (netNaive > 0) naiveWins++;
        // If gated was flat during a losing naive day/trade, attribute to blocking gates
        if (!gatedPos && netNaive < 0) {
          const entryS = states[naivePos.entryIdx];
          if (!entryS.gateCrowdingOk) {
            gateStats.crowding.blocked++;
            gateStats.crowding.avoidedLoss += Math.abs(netNaive);
          } else if (!entryS.gateVwapOk) {
            gateStats.vwap.blocked++;
            gateStats.vwap.avoidedLoss += Math.abs(netNaive);
          } else if (!entryS.gatePriorOk) {
            gateStats.prior.blocked++;
            gateStats.prior.avoidedLoss += Math.abs(netNaive);
          } else if (!entryS.gateDualOk) {
            gateStats.dual.blocked++;
            gateStats.dual.avoidedLoss += Math.abs(netNaive);
          }
        }
        naivePos = null;
      }
    } else if (i < states.length - 1 && (s.cpoRetPrev > 0.25 || s.usOpticsPct > 0.45)) {
      naiveEquity *= 1 - feeRate;
      naivePos = { dir: 1, entryPrice: s.close, entryIdx: i };
      // Also track immediate blocked entries
      if (!gatedPos) {
        if (!s.gateCrowdingOk && !s.gateVwapOk) {
          gateStats.crowding.blocked++;
        } else if (!s.gateVwapOk) {
          gateStats.vwap.blocked++;
        } else if (!s.gatePriorOk) {
          gateStats.prior.blocked++;
        } else if (!s.gateDualOk) {
          gateStats.dual.blocked++;
        }
      }
    }

    gatedDailyRets.push(gatedDayRet);
    if (gatedEquity > gatedPeak) gatedPeak = gatedEquity;
    const gatedDdPct = ((gatedEquity - gatedPeak) / gatedPeak) * 100;

    equityCurve.push({
      date: s.date,
      gatedReturnPct: round(((gatedEquity - initialCapital) / initialCapital) * 100, 2),
      naiveReturnPct: round(((naiveEquity - initialCapital) / initialCapital) * 100, 2),
      benchmarkPct: round(((s.close - baseBenchClose) / baseBenchClose) * 100, 2),
      gatedDrawdownPct: round(gatedDdPct, 2),
      tmtCrowdingPct: s.tmtCrowdingPct,
      posteriorProb: s.posteriorProb,
    });
  }

  // Compute Summary KPIs
  const nDays = Math.max(1, equityCurve.length);
  const gatedTotalRet = ((gatedEquity - initialCapital) / initialCapital) * 100;
  const naiveTotalRet = ((naiveEquity - initialCapital) / initialCapital) * 100;
  const benchTotalRet = equityCurve[equityCurve.length - 1]?.benchmarkPct || 0;

  const gatedAnnual = ((1 + gatedTotalRet / 100) ** (252 / nDays) - 1) * 100;
  const naiveAnnual = ((1 + naiveTotalRet / 100) ** (252 / nDays) - 1) * 100;

  const maxGatedDd = Math.min(0, ...equityCurve.map((e) => e.gatedDrawdownPct));

  // Naive drawdown & Sharpe approximation from equityCurve
  let naivePeak = 0;
  let maxNaiveDd = 0;
  const naiveDailyRets: number[] = [];
  for (let i = 0; i < equityCurve.length; i++) {
    const val = 100 + equityCurve[i].naiveReturnPct;
    const prevVal = i > 0 ? 100 + equityCurve[i - 1].naiveReturnPct : 100;
    naiveDailyRets.push((val - prevVal) / prevVal);
    if (val > naivePeak) naivePeak = val;
    const dd = ((val - naivePeak) / naivePeak) * 100;
    if (dd < maxNaiveDd) maxNaiveDd = dd;
  }

  const winTrades = gatedTrades.filter((t) => t.returnPct > 0);
  const lossTrades = gatedTrades.filter((t) => t.returnPct <= 0);
  const grossWin = winTrades.reduce((s, t) => s + t.returnPct, 0);
  const grossLoss = Math.abs(lossTrades.reduce((s, t) => s + t.returnPct, 0));
  const winRatePct = gatedTrades.length ? round((winTrades.length / gatedTrades.length) * 100, 1) : 0;
  const profitFactor = grossLoss > 0.01 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? 3.2 : 1.0;

  const pWin = winRatePct / 100;
  const avgWin = winTrades.length ? mean(winTrades.map((t) => t.returnPct)) : 3.5;
  const avgLoss = lossTrades.length ? Math.abs(mean(lossTrades.map((t) => t.returnPct))) : 2.5;
  const bRatio = avgLoss > 0.1 ? avgWin / avgLoss : 1.4;
  const kellySuggestedPct = round(clamp(Math.max(0, (pWin * bRatio - (1 - pWin)) / bRatio) * 0.5 * 100, 0, 45), 1);

  return {
    targetSymbol: rawSym,
    targetName: meta.name,
    executionRule: meta.isPair
      ? '跨市场中性配对 (做多CPO三中军 / 做空IM0中证1000期指 · 剥离大盘抽血Beta)'
      : meta.isFutures
      ? '国内股指期货 T+0 双向交易 (1.8x杠杆 · 严守09:00美股截断)'
      : 'A股/ETF T+1 严守制度 · 仅做多(1.0x) · 无未来函数泄露',
    startDate: windowBars[0].date,
    endDate: windowBars[windowBars.length - 1].date,
    gatedMetrics: {
      totalReturnPct: round(gatedTotalRet, 2),
      annualReturnPct: round(gatedAnnual, 2),
      sharpe: computeSharpe(gatedDailyRets),
      informationRatio: computeInfoRatio(gatedDailyRets, benchDailyRets),
      maxDrawdownPct: round(Math.abs(maxGatedDd), 2),
      winRatePct,
      profitFactor,
      kellySuggestedPct,
      tradeCount: gatedTrades.length,
    },
    naiveMetrics: {
      totalReturnPct: round(naiveTotalRet, 2),
      annualReturnPct: round(naiveAnnual, 2),
      sharpe: computeSharpe(naiveDailyRets),
      maxDrawdownPct: round(Math.abs(maxNaiveDd), 2),
      winRatePct: naiveTradeReturns.length
        ? round((naiveWins / naiveTradeReturns.length) * 100, 1)
        : 0,
      tradeCount: naiveTradeReturns.length,
    },
    benchmarkReturnPct: round(benchTotalRet, 2),
    gateAttribution: [
      {
        gateName: 'TMT拥挤度门控 (>38%拦截)',
        blockedTrades: gateStats.crowding.blocked,
        avoidedLossPct: round(gateStats.crowding.avoidedLoss, 2),
      },
      {
        gateName: '09:45 VWAP真承接门控',
        blockedTrades: gateStats.vwap.blocked,
        avoidedLossPct: round(gateStats.vwap.avoidedLoss, 2),
      },
      {
        gateName: '海外光学先验锚门控',
        blockedTrades: gateStats.prior.blocked,
        avoidedLossPct: round(gateStats.prior.avoidedLoss, 2),
      },
      {
        gateName: '宁德双核 & 期权Skew门控',
        blockedTrades: gateStats.dual.blocked,
        avoidedLossPct: round(gateStats.dual.avoidedLoss, 2),
      },
    ],
    equityCurve,
    trades: gatedTrades.reverse(),
  };
}
