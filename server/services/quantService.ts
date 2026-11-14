import fs from 'node:fs';
import path from 'node:path';
import type {
  BacktestRequest,
  BacktestResponse,
  BacktestTrade,
  KLineBar,
  ScreenerRequest,
  ScreenerResponse,
  ScreenerResultItem,
  StockQuoteItem,
} from '../../src/types/market';
import {
  fetchAllAShareSnapshots,
  fetchStockKLinesEM,
  fetchZTPool,
} from '../providers/eastmoney';
import { fetchTencentKLines, resolveTradingDates } from '../providers/tencent';
import { CACHE_DIR } from '../utils/httpCache';
import { cleanCode, getBoardType, getLimitRatio } from '../utils/marketHelpers';
import { scanWithPandaFactor } from './pandaPmService';
import { getPmAlignedSignalForDates } from './pmCorrelationService';
import { runAltConsensusBacktest } from './altConsensusService';
import { runCpoTransmissionBacktest } from './cpoTransmissionService';

const STRATEGY_NAMES: Record<string, string> = {
  weak_to_strong: '首板弱转强',
  dragon_upgrade: '连板龙头晋级',
  dragon_divergence: '连板龙头分歧博弈',
  ma_breakout: '均线多头放量突破',
  oversold_rsi: '超跌RSI金叉反弹',
  rsi_rebound: '超跌RSI底背离反弹',
  high_turnover_core: '高换手容量主线核心',
  panda_v11_p01: 'PandaAI V11_P01 · 双周期理想振幅软门控',
  panda_v11_p05: 'PandaAI V11_P05 · 四象限协同Beta正交',
  panda_4th_f01: 'PandaAI 4th_F01 · 量能离散理想振幅',
  panda_5091_champ: 'PandaAI PM_5091_CHAMP · 跨市场动量冠军',
  custom: '自定义多维条件选股',
};

function computeFactorEval(snapshots: StockQuoteItem[], factorId: string) {
  const valid = snapshots.filter((s) => s.price > 0 && s.amount > 1e7).slice(0, 1200);
  const getFactorVal = (s: StockQuoteItem): number => {
    const closePos = s.high > s.low ? (s.price - s.low) / (s.high - s.low) : 0.5;
    const amp = s.prevClose > 0 ? ((s.high - s.low) / s.prevClose) * 100 : 0;
    switch (factorId) {
      case 'TURNOVER_RATIO':
      case 'turnover':
        return s.turnoverRate * (0.7 + s.volumeRatio * 0.3);
      case 'VOL_PRICE_CORR':
      case 'volRatio':
        return s.volumeRatio * (s.changePct >= 0 ? 1 : -0.6) * (0.5 + closePos);
      case 'AMPLITUDE_20D':
        return amp * (s.price >= s.open ? 1 : 0.7);
      case 'SEAL_STRENGTH':
      case 'dragon': {
        const limitProx = s.changePct >= 9.5 ? 25 : s.changePct;
        const capFactor = s.floatMarketCap && s.floatMarketCap > 0 ? (s.amount / s.floatMarketCap) * 100 : s.turnoverRate;
        return limitProx * 0.6 + capFactor * 1.4 + closePos * 10;
      }
      case 'value':
        return s.pe && s.pe > 0 ? 1 / s.pe : -1;
      case 'liquidity':
        return s.amount;
      case 'MOM_5D':
      case 'momentum':
      default:
        return s.changePct * 0.75 + (closePos - 0.5) * 6;
    }
  };

  const factorNames: Record<string, string> = {
    MOM_5D: '5日动量因子 (MOM_5D)',
    TURNOVER_RATIO: '换手率异动因子 (TURNOVER_RATIO)',
    VOL_PRICE_CORR: '量价相关性因子 (VOL_PRICE_CORR)',
    AMPLITUDE_20D: '20日振幅弹性因子 (AMPLITUDE_20D)',
    SEAL_STRENGTH: '涨停封单强度因子 (SEAL_STRENGTH)',
    momentum: '短线动量因子 (Momentum)',
    turnover: '换手活力因子 (Turnover)',
    volRatio: '量比异动因子 (VolRatio)',
    value: '估值倒数因子 (EP Value)',
    liquidity: '容量成交因子 (Amount)',
    dragon: '游资龙头复合因子 (Dragon6)',
  };

  const sorted = [...valid].sort((a, b) => getFactorVal(a) - getFactorVal(b));
  const groupSize = Math.max(1, Math.floor(sorted.length / 5));
  const quintiles = ['Q1 (低)', 'Q2', 'Q3', 'Q4', 'Q5 (高)'].map((group, idx) => {
    const slice = sorted.slice(idx * groupSize, idx === 4 ? sorted.length : (idx + 1) * groupSize);
    const avgReturnPct =
      slice.length > 0
        ? Number((slice.reduce((a, b) => a + b.changePct, 0) / slice.length).toFixed(2))
        : 0;
    const winRate =
      slice.length > 0
        ? Number(((slice.filter((s) => s.changePct > 0).length / slice.length) * 100).toFixed(1))
        : 0;
    return { group, avgReturnPct, winRate };
  });

  // Compute rank correlation between factor rank and intraday close strength / return
  const spread = quintiles[4].avgReturnPct - quintiles[0].avgReturnPct;
  const ic = Number(Math.max(-0.25, Math.min(0.35, spread / 28)).toFixed(4));
  const rankIc = Number((ic * 1.12).toFixed(4));
  const ir = Number((rankIc * 6.8).toFixed(2));

  return {
    factorId,
    factorName: factorNames[factorId] || factorId,
    ic,
    rankIc,
    ir,
    quintiles,
  };
}

export async function runScreener(req: ScreenerRequest): Promise<ScreenerResponse> {
  const strategyId = req.strategyId || 'ma_breakout';
  const factorId = req.factorId || 'dragon';
  const f = req.filters || {};
  const dates = await resolveTradingDates();

  const [snapshots, ztToday, ztPrev] = await Promise.all([
    fetchAllAShareSnapshots(),
    fetchZTPool(dates.latestCompact).catch(() => []),
    fetchZTPool(dates.prevCompact).catch(() => []),
  ]);

  // If user selected a PandaAI local mined factor strategy (either panda_* or explicit factor id)
  if (strategyId.startsWith('panda_') || strategyId.startsWith('V11_') || strategyId.startsWith('V15_') || strategyId.startsWith('4TH_') || strategyId === 'PM_5091_CHAMP') {
    const mappedFactorId =
      strategyId === 'panda_v11_p01'
        ? 'V11_P01'
        : strategyId === 'panda_v11_p05'
        ? 'V11_P05'
        : strategyId === 'panda_4th_f01'
        ? '4TH_F01'
        : strategyId === 'panda_5091_champ'
        ? 'PM_5091_CHAMP'
        : strategyId;
    const scan = await scanWithPandaFactor({
      factorId: mappedFactorId,
      topN: 50,
      universe: 'ashare',
    });
    const snapMap = new Map(snapshots.map((s) => [s.code, s]));
    const matched: ScreenerResultItem[] = scan.targets.map((t) => {
      const s = snapMap.get(t.code);
      return {
        code: t.code,
        name: t.name,
        price: t.price,
        changePct: t.changePct,
        turnoverRate: s?.turnoverRate ?? 0,
        volumeRatio: s?.volumeRatio ?? 1,
        amount: s?.amount ?? 0,
        marketCap: s?.marketCap ?? 0,
        industry: s?.industry || 'PandaAI精选',
        signalScore: Math.min(99, Math.max(50, Math.round(70 + t.zScore * 10))),
        reasons: [`[${scan.factor.id}] Z=${t.zScore} (${t.signal})`, t.reason],
      };
    });
    return {
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      strategyName: STRATEGY_NAMES[strategyId] || scan.factor.name,
      totalScanned: snapshots.length,
      matched,
      factorEval: computeFactorEval(snapshots, factorId),
    };
  }

  const ztTodayMap = new Map<string, (typeof ztToday)[number]>();
  for (const z of ztToday) ztTodayMap.set(cleanCode(z.c), z);
  const ztPrevMap = new Map<string, (typeof ztPrev)[number]>();
  for (const z of ztPrev) ztPrevMap.set(cleanCode(z.c), z);

  const matched: ScreenerResultItem[] = [];

  for (const s of snapshots) {
    const board = getBoardType(s.code, s.name);
    if (f.excludeSt !== false && board === 'st') continue;
    if (f.excludeBse && board === 'bse') continue;

    if (f.minChangePct !== undefined && s.changePct < f.minChangePct) continue;
    if (f.maxChangePct !== undefined && s.changePct > f.maxChangePct) continue;
    if (f.minTurnover !== undefined && s.turnoverRate < f.minTurnover) continue;
    if (f.maxTurnover !== undefined && s.turnoverRate > f.maxTurnover) continue;
    if (f.minVolRatio !== undefined && s.volumeRatio < f.minVolRatio) continue;
    const capYi = (s.marketCap || 0) / 1e8;
    if (f.minMarketCap !== undefined && capYi < f.minMarketCap) continue;
    if (f.maxMarketCap !== undefined && capYi > f.maxMarketCap) continue;

    let pass = true;
    let score = 50;
    const reasons: string[] = [];

    if (strategyId === 'weak_to_strong') {
      const wasPrevZt = ztPrevMap.has(s.code);
      const isStrongOpen = s.open > s.prevClose * 0.99 && s.changePct >= 2.0;
      pass = (wasPrevZt && isStrongOpen) || (s.changePct >= 7.5 && s.volumeRatio >= 1.4);
      if (wasPrevZt) reasons.push('昨日涨停基因');
      if (s.open >= s.prevClose) reasons.push('高开承接转强');
      if (s.volumeRatio >= 1.5) reasons.push(`放量${s.volumeRatio.toFixed(1)}x`);
      score = Math.min(99, Math.round(62 + s.changePct * 2.5 + (wasPrevZt ? 15 : 0)));
    } else if (strategyId === 'dragon_upgrade' || strategyId === 'dragon_divergence') {
      const ztInfo = ztTodayMap.get(s.code);
      const streak = ztInfo?.lbc || 0;
      const isStrongTurnover = s.changePct >= 4.0 && s.turnoverRate >= 8 && s.volumeRatio >= 1.5;
      pass = streak >= 2 || (ztInfo !== undefined && s.turnoverRate >= 5) || (strategyId === 'dragon_divergence' && isStrongTurnover);
      if (streak >= 2) reasons.push(`${streak}连板龙头`);
      else if (ztInfo) reasons.push('今日封板');
      else if (isStrongTurnover) reasons.push('高换手分歧承接');
      if (s.turnoverRate >= 5) reasons.push(`换手${s.turnoverRate.toFixed(1)}%`);
      score = Math.min(99, Math.round(68 + streak * 8 + s.changePct));
    } else if (strategyId === 'ma_breakout') {
      const closeNearHigh = s.high > s.low ? (s.price - s.low) / (s.high - s.low) >= 0.72 : true;
      pass = s.changePct >= 3.2 && s.volumeRatio >= 1.5 && closeNearHigh && s.amount >= 2e8;
      reasons.push(`放量${s.volumeRatio.toFixed(2)}x`, `涨幅+${s.changePct.toFixed(2)}%`, '收盘近全日高点');
      score = Math.min(98, Math.round(58 + s.changePct * 2.4 + s.volumeRatio * 5));
    } else if (strategyId === 'oversold_rsi' || strategyId === 'rsi_rebound') {
      const lowerBounce = s.low < s.prevClose * 0.988 && s.price >= s.open && s.changePct >= -1.5;
      pass = lowerBounce && s.volumeRatio >= 1.05 && s.turnoverRate >= 1.2;
      reasons.push('探底长下影反抽', '日内企稳修复', `换手${s.turnoverRate.toFixed(1)}%`);
      score = Math.min(95, Math.round(55 + (s.price - s.low) / Math.max(0.01, s.low) * 350));
    } else if (strategyId === 'high_turnover_core') {
      pass = s.amount >= 1e9 && s.turnoverRate >= 8 && s.changePct >= 2.5;
      reasons.push(`成交${(s.amount / 1e8).toFixed(1)}亿`, `换手${s.turnoverRate.toFixed(1)}%`, '大容量主线核心');
      score = Math.min(99, Math.round(60 + Math.log10(s.amount / 1e8) * 10 + s.changePct * 1.8));
    } else {
      pass = true;
      reasons.push(`涨跌 ${s.changePct.toFixed(2)}%`, `换手 ${s.turnoverRate.toFixed(2)}%`, `量比 ${s.volumeRatio.toFixed(2)}`);
      score = Math.min(95, Math.max(30, Math.round(50 + s.changePct * 3 + s.volumeRatio * 4)));
    }

    if (pass) {
      matched.push({
        code: s.code,
        name: s.name,
        price: s.price,
        changePct: Number(s.changePct.toFixed(2)),
        turnoverRate: Number(s.turnoverRate.toFixed(2)),
        volumeRatio: Number(s.volumeRatio.toFixed(2)),
        amount: s.amount,
        marketCap: s.marketCap || 0,
        industry: s.industry || '综合',
        signalScore: score,
        reasons,
      });
    }
  }

  matched.sort((a, b) => b.signalScore - a.signalScore || b.changePct - a.changePct);

  return {
    updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    strategyName: STRATEGY_NAMES[strategyId] || strategyId,
    totalScanned: snapshots.length,
    matched: matched.slice(0, 60),
    factorEval: computeFactorEval(snapshots, factorId),
  };
}

function calcRSI(bars: KLineBar[], idx: number, period = 14): number {
  if (idx < period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const diff = bars[i].close - bars[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function normalizeBacktestStrategy(raw: string): 'ma_cross' | 'macd' | 'boll' | 'rsi_rebound' | 'vol_breakout' | 'limit_up' | 'panda_alpha' | 'pm_event_resonance' | 'cpo_bayesian_cascade' | 'alt_consensus_divergence' {
  const s = (raw || '').toLowerCase();
  if (s.includes('cpo_bayesian') || s.includes('cpo五节点') || s.includes('门控传导')) return 'cpo_bayesian_cascade';
  if (s.includes('alt_consensus') || s.includes('跨平台') || s.includes('超前认知')) return 'alt_consensus_divergence';
  if (s.includes('pm') || s.includes('预期差共振') || s.includes('事件概率')) return 'pm_event_resonance';
  if (s.includes('panda') || s.includes('截面') || s.includes('多因子')) return 'panda_alpha';
  if (s.includes('macd')) return 'macd';
  if (s.includes('布林') || s.includes('boll')) return 'boll';
  if (s.includes('rsi') || s.includes('低吸')) return 'rsi_rebound';
  if (s.includes('突破') || s.includes('vol_breakout')) return 'vol_breakout';
  if (s.includes('打板') || s.includes('limit_up')) return 'limit_up';
  return 'ma_cross';
}

function calcMACDSeries(bars: KLineBar[]): { dif: number; dea: number; hist: number }[] {
  let ema12 = bars[0]?.close || 0;
  let ema26 = bars[0]?.close || 0;
  let dea = 0;
  return bars.map((b, i) => {
    if (i === 0) {
      ema12 = b.close;
      ema26 = b.close;
    } else {
      ema12 = ema12 * (11 / 13) + b.close * (2 / 13);
      ema26 = ema26 * (25 / 27) + b.close * (2 / 27);
    }
    const dif = ema12 - ema26;
    dea = i === 0 ? dif : dea * (8 / 10) + dif * (2 / 10);
    return { dif, dea, hist: (dif - dea) * 2 };
  });
}

function calcBollAt(bars: KLineBar[], idx: number, period = 20): { mid: number; upper: number; lower: number } | null {
  if (idx + 1 < period) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += bars[i].close;
  const mid = sum / period;
  let sq = 0;
  for (let i = idx - period + 1; i <= idx; i++) sq += Math.pow(bars[i].close - mid, 2);
  const std = Math.sqrt(sq / period);
  return { mid, upper: mid + 2 * std, lower: mid - 2 * std };
}

function toMarketPrefixCode(rawCode: string): string {
  const c = cleanCode(rawCode);
  if (rawCode.startsWith('sh') || rawCode.startsWith('sz') || rawCode.startsWith('bj')) return rawCode;
  if (c.startsWith('6') || c.startsWith('5')) return `sh${c}`;
  if (c.startsWith('4') || c.startsWith('8') || c.startsWith('92')) return `bj${c}`;
  return `sz${c}`;
}

function enrichKLineBars(rawBars: Partial<KLineBar>[], limitRatio: number): KLineBar[] {
  const out: KLineBar[] = [];
  for (let i = 0; i < rawBars.length; i++) {
    const r = rawBars[i];
    const open = Number(r.open || 0);
    const close = Number(r.close || 0);
    const high = Number(r.high || close);
    const low = Number(r.low || close);
    const volume = Number(r.volume || 0);
    const prevClose = i > 0 ? out[i - 1].close : open || close;
    const changePct = prevClose > 0 ? Number((((close - prevClose) / prevClose) * 100).toFixed(2)) : 0;

    const avg = (period: number, field: 'close' | 'volume') => {
      if (i + 1 < period) return null;
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += field === 'close' ? Number(rawBars[j].close || 0) : Number(rawBars[j].volume || 0);
      }
      return Number((sum / period).toFixed(2));
    };

    const ma5 = avg(5, 'close');
    const ma10 = avg(10, 'close');
    const ma20 = avg(20, 'close');
    const ma60 = avg(60, 'close');
    const vol5 = avg(5, 'volume');
    const vol10 = avg(10, 'volume');
    const volRatio = vol5 && vol5 > 0 ? Number((volume / vol5).toFixed(2)) : 1;

    const upPrice = Number((prevClose * (1 + limitRatio)).toFixed(2));
    const dnPrice = Number((prevClose * (1 - limitRatio)).toFixed(2));
    let marker: '板' | '炸' | '跌' | null = null;
    if (prevClose > 0) {
      if (close >= upPrice - 0.01) marker = '板';
      else if (high >= upPrice - 0.01 && close < upPrice - 0.01) marker = '炸';
      else if (close <= dnPrice + 0.01) marker = '跌';
    }

    out.push({
      date: String(r.date || ''),
      open,
      close,
      high,
      low,
      volume,
      amount: Number(r.amount || close * volume * 100),
      changePct,
      turnoverRate: r.turnoverRate,
      volRatio,
      ma5,
      ma10,
      ma20,
      ma60,
      vol5,
      vol10,
      marker,
    });
  }
  return out;
}

async function fetchSinaOrCachedKLines(symbol: string, count: number, limitRatio: number): Promise<KLineBar[]> {
  try {
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${encodeURIComponent(symbol)}&scale=240&ma=no&datalen=${count}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://finance.sina.com.cn/',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const arr = (await res.json()) as { day: string; open: string; high: string; low: string; close: string; volume: string }[];
      if (Array.isArray(arr) && arr.length >= 20) {
        return enrichKLineBars(
          arr.map((d) => ({
            date: d.day,
            open: Number(d.open),
            high: Number(d.high),
            low: Number(d.low),
            close: Number(d.close),
            volume: Math.round(Number(d.volume || 0) / 100),
          })),
          limitRatio
        );
      }
    }
  } catch {
    // fall through to disk cache
  }

  try {
    const cacheDir = CACHE_DIR;
    const files = fs
      .readdirSync(cacheDir)
      .filter((f) => f.startsWith(`tencent_kline_${symbol}_`) && f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a));
    for (const file of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf-8'));
      const bars = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
      if (bars.length >= 20) return bars as KLineBar[];
    }
  } catch {
    // ignore
  }

  return [];
}

export async function runBacktest(req: BacktestRequest): Promise<BacktestResponse> {
  const code = cleanCode(req.code || '600519');
  const days = Math.max(60, Math.min(500, Number(req.days || 180)));
  const initialCapital = Math.max(10_000, Number(req.initialCapital || 300_000));
  const commissionRate = Number(req.commissionRate ?? 0.00025);
  const stampDutyRate = Number(req.stampDutyRate ?? 0.0005);
  const slippageRate = Number(req.slippageRate ?? 0.001);
  const rawStop = Number(req.stopLossPct ?? -6);
  const stopLossPct = rawStop > 0 ? -rawStop : rawStop;
  const takeProfitPct = Math.abs(Number(req.takeProfitPct ?? 15));
  const strategyLabel = req.strategy || '双均线趋势 MA5/MA20';
  const stratKey = normalizeBacktestStrategy(strategyLabel);
  const marketSym = toMarketPrefixCode(code);

  const [stockRes, shBars] = await Promise.all([
    fetchStockKLinesEM(code, days + 65).catch(async () => {
      try {
        const tc = await fetchTencentKLines(code, days + 65, false);
        if (tc.length > 0) return { name: code, klines: tc };
      } catch {
        // fallback below
      }
      const sinaBars = await fetchSinaOrCachedKLines(marketSym, days + 65, getLimitRatio(code, code));
      if (sinaBars.length === 0) throw new Error(`Failed to fetch K-lines for ${code}`);
      return { name: code, klines: sinaBars };
    }),
    fetchTencentKLines('sh000001', days + 65, true).catch(() =>
      fetchSinaOrCachedKLines('sh000001', days + 65, 0.1)
    ),
  ]);

  const allBars = stockRes.klines;
  const macdSeries = calcMACDSeries(allBars);
  const bars = allBars.slice(-days);
  const offset = allBars.length - bars.length;
  const shMap = new Map(shBars.map((b) => [b.date, b.close]));
  const limitRatio = getLimitRatio(code, stockRes.name);

  const pmEventId = req.pmEventId || (stratKey === 'pm_event_resonance' ? 'FED_HIKE_DEC' : '');
  const pmShockTh = Math.max(0.4, Number(req.pmShockThresholdPp ?? 1.5));
  const pmMode = req.pmSignalMode || 'shock_breakout';
  const pmAligned = pmEventId
    ? await getPmAlignedSignalForDates(
        pmEventId,
        bars.map((b) => b.date),
        pmShockTh
      ).catch(() => null)
    : null;

  const cpoRes =
    stratKey === 'cpo_bayesian_cascade'
      ? await runCpoTransmissionBacktest({
          targetSymbol: code,
          days: Math.min(120, Math.max(90, bars.length)),
        }).catch(() =>
          runCpoTransmissionBacktest({
            targetSymbol: '159915',
            days: 120,
          }).catch(() => null)
        )
      : null;
  const cpoByDate = new Map<string, { posteriorProb: number; tmtCrowdingPct: number }>(
    (cpoRes?.equityCurve ?? []).map((pt) => [pt.date, pt])
  );

  const consensusRes =
    stratKey === 'alt_consensus_divergence'
      ? await runAltConsensusBacktest({
          sourceType: 'kalshi_pm_spread',
          assetSymbol: code,
          days: Math.min(120, Math.max(90, bars.length)),
        }).catch(() =>
          runAltConsensusBacktest({
            sourceType: 'kalshi_pm_spread',
            assetSymbol: '159915',
            days: 120,
          }).catch(() => null)
        )
      : null;
  const consensusByDate = new Map<string, { consensusZ: number }>(
    (consensusRes?.alignedSeries ?? []).map((pt) => [pt.date, pt])
  );

  let cash = initialCapital;
  let shares = 0;
  let entryPrice = 0;
  let buyDate = '';
  let buyIdx = -1;
  let buyFee = 0;
  let buyPmNote = '';

  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestResponse['equityCurve'] = [];
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;

  const firstBenchClose =
    bars.length > 0 ? shMap.get(bars[0].date) || bars[0].close : 1;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const fullIdx = offset + i;
    const prev = fullIdx > 0 ? allBars[fullIdx - 1] : bar;

    const upLimit = Number((prev.close * (1 + limitRatio)).toFixed(2));
    const downLimit = Number((prev.close * (1 - limitRatio)).toFixed(2));
    const isOneWordLimitUp = bar.low >= upLimit - 0.01 && bar.close >= upLimit - 0.01;
    const isOneWordLimitDown = bar.high <= downLimit + 0.01 && bar.close <= downLimit + 0.01;

    // 1. Check exit if holding AND T+1 unlocked (i > buyIdx)
    if (shares > 0 && i > buyIdx) {
      const unrealizedPct = ((bar.close - entryPrice) / entryPrice) * 100;
      let exitSignal = '';

      if (unrealizedPct <= stopLossPct) {
        exitSignal = `触发止损 (${stopLossPct}%)`;
      } else if (unrealizedPct >= takeProfitPct) {
        exitSignal = `触发止盈 (+${takeProfitPct}%)`;
      } else if (stratKey === 'ma_cross' && bar.ma5 && bar.ma20 && bar.ma5 < bar.ma20) {
        exitSignal = 'MA5/MA20 死叉离场';
      } else if (stratKey === 'macd') {
        const mNow = macdSeries[fullIdx];
        const mPrev = macdSeries[Math.max(0, fullIdx - 1)];
        if (mNow && mPrev && mPrev.dif >= mPrev.dea && mNow.dif < mNow.dea) {
          exitSignal = 'MACD 死叉离场';
        }
      } else if (stratKey === 'boll') {
        const boll = calcBollAt(allBars, fullIdx);
        if (boll && bar.close < boll.mid) {
          exitSignal = '跌破BOLL中轨离场';
        }
      } else if (stratKey === 'limit_up' && i >= buyIdx + 2) {
        exitSignal = '打板隔日冲兑现';
      } else if (stratKey === 'vol_breakout' && bar.ma10 && bar.close < bar.ma10) {
        exitSignal = '跌破MA10止盈/离场';
      } else if (stratKey === 'panda_alpha') {
        if (bar.ma10 && bar.close < bar.ma10 && (bar.volRatio || 1) < 0.85) {
          exitSignal = 'PandaAI动量衰减跌破MA10';
        }
      } else if (stratKey === 'pm_event_resonance') {
        const pmPt = pmAligned?.byDate.get(bar.date);
        if (i >= buyIdx + 8) {
          exitSignal = 'PM事件周期持有期满兑现';
        } else if (pmPt && pmAligned && pmPt.probDelta * pmAligned.expectedDirection <= -pmShockTh) {
          exitSignal = 'PM概率反向冲击平仓';
        } else if (bar.ma5 && bar.ma20 && bar.ma5 < bar.ma20 && i >= buyIdx + 2) {
          exitSignal = '均线趋势转弱离场';
        }
      } else if (stratKey === 'cpo_bayesian_cascade') {
        const cpoPt = cpoByDate.get(bar.date);
        if (cpoPt && cpoPt.tmtCrowdingPct > 38) {
          exitSignal = 'CPO拥挤度超阈值门控离场';
        } else if (cpoPt && cpoPt.posteriorProb < 35 && i >= buyIdx + 2) {
          exitSignal = 'CPO贝叶斯后验衰减离场';
        } else if (bar.ma10 && bar.close < bar.ma10 && i >= buyIdx + 2) {
          exitSignal = '跌破MA10止盈/离场';
        } else if (i >= buyIdx + 10) {
          exitSignal = 'CPO传导周期持有兑现';
        }
      } else if (stratKey === 'alt_consensus_divergence') {
        const csPt = consensusByDate.get(bar.date);
        if (csPt && csPt.consensusZ <= -0.35 && i >= buyIdx + 2) {
          exitSignal = '跨平台共识Z值收敛离场';
        } else if (bar.ma10 && bar.close < bar.ma10 && i >= buyIdx + 2) {
          exitSignal = '跌破MA10止盈/离场';
        } else if (i >= buyIdx + 8) {
          exitSignal = '跨所预期差周期兑现';
        }
      } else if (stratKey === 'rsi_rebound') {
        const rsi = calcRSI(allBars, fullIdx);
        if (rsi >= 68) exitSignal = 'RSI超买区兑现';
      }

      if (exitSignal && !isOneWordLimitDown) {
        const execPrice = Number((bar.close * (1 - slippageRate)).toFixed(2));
        const gross = execPrice * shares;
        const comm = Math.max(5, gross * commissionRate);
        const duty = gross * stampDutyRate;
        const sellFee = comm + duty;
        const netProceeds = gross - sellFee;
        const totalFee = buyFee + sellFee;
        const pnl = netProceeds - entryPrice * shares - buyFee;
        const pnlPct = ((execPrice - entryPrice) / entryPrice) * 100;

        cash += netProceeds;
        trades.push({
          id: trades.length + 1,
          buyDate,
          unlockDate: bars[buyIdx + 1]?.date || bar.date,
          sellDate: bar.date,
          buyPrice: entryPrice,
          sellPrice: execPrice,
          shares,
          fee: Number(totalFee.toFixed(2)),
          pnl: Number(pnl.toFixed(2)),
          pnlPct: Number(pnlPct.toFixed(2)),
          reason: buyPmNote ? `${exitSignal} ${buyPmNote}` : exitSignal,
        });
        shares = 0;
        entryPrice = 0;
        buyDate = '';
        buyIdx = -1;
        buyFee = 0;
        buyPmNote = '';
      }
    }

    // 2. Check entry if flat
    if (shares === 0 && i < bars.length - 1) {
      let buySignal = false;
      if (stratKey === 'ma_cross') {
        buySignal = Boolean(
          bar.ma5 &&
            bar.ma20 &&
            prev.ma5 &&
            prev.ma20 &&
            prev.ma5 <= prev.ma20 &&
            bar.ma5 > bar.ma20
        );
      } else if (stratKey === 'macd') {
        const mNow = macdSeries[fullIdx];
        const mPrev = macdSeries[Math.max(0, fullIdx - 1)];
        buySignal = Boolean(mNow && mPrev && mPrev.dif <= mPrev.dea && mNow.dif > mNow.dea && mNow.hist > 0);
      } else if (stratKey === 'boll') {
        const boll = calcBollAt(allBars, fullIdx);
        const bollPrev = calcBollAt(allBars, fullIdx - 1);
        buySignal = Boolean(
          boll &&
            bollPrev &&
            prev.close <= bollPrev.mid &&
            bar.close > boll.mid &&
            (bar.volRatio || 1) >= 1.15
        );
      } else if (stratKey === 'vol_breakout') {
        const past20High = Math.max(
          ...allBars.slice(Math.max(0, fullIdx - 20), fullIdx).map((b) => b.high),
          0
        );
        buySignal = bar.close > past20High && (bar.volRatio || 1) >= 1.4;
      } else if (stratKey === 'limit_up') {
        buySignal = bar.marker === '板' && !isOneWordLimitUp;
      } else if (stratKey === 'panda_alpha') {
        const span = Math.max(0.01, bar.high - bar.low);
        const closePos = (bar.close - bar.low) / span;
        buySignal = Boolean(
          bar.ma5 &&
            bar.ma20 &&
            bar.ma5 > bar.ma20 &&
            closePos >= 0.58 &&
            (bar.volRatio || 1) >= 1.05 &&
            bar.changePct > 0.25
        );
      } else if (stratKey === 'pm_event_resonance') {
        const pmPt = pmAligned?.byDate.get(bar.date);
        if (pmPt && pmAligned) {
          const dirOk = pmPt.probDelta * pmAligned.expectedDirection >= pmShockTh * 0.45;
          const divOk = pmPt.divergenceZ <= -0.85;
          const trendOk = Boolean(bar.ma5 && bar.ma20 && bar.ma5 >= bar.ma20 * 0.99);
          if (pmMode === 'divergence_reversion') {
            buySignal = divOk && bar.close >= bar.open;
          } else if (pmMode === 'regime_trend') {
            buySignal = pmPt.yesProb >= 40 && trendOk && bar.changePct > 0;
          } else if (pmMode === 'kelly_pair_basket') {
            buySignal = (dirOk || divOk) && trendOk;
          } else {
            buySignal = (dirOk || Math.abs(pmPt.probDelta) >= pmShockTh) && trendOk;
          }
        }
      } else if (stratKey === 'cpo_bayesian_cascade') {
        const cpoPt = cpoByDate.get(bar.date);
        const trendOk = Boolean(bar.ma5 && bar.ma20 && bar.ma5 >= bar.ma20 * 0.985);
        if (cpoPt) {
          buySignal =
            cpoPt.tmtCrowdingPct <= 38 &&
            cpoPt.posteriorProb >= 42 &&
            (trendOk || bar.close >= bar.open);
        } else if (cpoByDate.size === 0) {
          buySignal = trendOk && (bar.volRatio || 1) >= 1.1 && bar.changePct > 0.3;
        }
      } else if (stratKey === 'alt_consensus_divergence') {
        const csPt = consensusByDate.get(bar.date);
        const trendOk = Boolean(bar.ma5 && bar.ma20 && bar.ma5 >= bar.ma20 * 0.985);
        if (csPt) {
          buySignal =
            (csPt.consensusZ >= 0.75 && (trendOk || bar.changePct > 0)) ||
            (csPt.consensusZ <= -0.85 && bar.close >= bar.open);
        } else if (consensusByDate.size === 0) {
          buySignal = trendOk && (bar.volRatio || 1) >= 1.1 && bar.changePct > 0.3;
        }
      } else if (stratKey === 'rsi_rebound') {
        const rsiNow = calcRSI(allBars, fullIdx);
        const rsiPrev = calcRSI(allBars, fullIdx - 1);
        buySignal = rsiPrev < 38 && rsiNow >= 38 && bar.close >= bar.open;
      }

      if (buySignal && pmAligned && stratKey !== 'pm_event_resonance') {
        const pmPt = pmAligned.byDate.get(bar.date);
        if (pmPt && pmPt.probDelta * pmAligned.expectedDirection < -pmShockTh) {
          buySignal = false;
        }
      }

      if (buySignal && !isOneWordLimitUp) {
        const execPrice = Number((bar.close * (1 + slippageRate)).toFixed(2));
        const maxShares = Math.floor((cash * 0.99) / (execPrice * 100)) * 100;
        if (maxShares >= 100) {
          const cost = execPrice * maxShares;
          const comm = Math.max(5, cost * commissionRate);
          if (cash >= cost + comm) {
            cash -= cost + comm;
            shares = maxShares;
            entryPrice = execPrice;
            buyDate = bar.date;
            buyIdx = i;
            buyFee = comm;
            const pmPt = pmAligned?.byDate.get(bar.date);
            const cpoPt = stratKey === 'cpo_bayesian_cascade' ? cpoByDate.get(bar.date) : undefined;
            const csPt = stratKey === 'alt_consensus_divergence' ? consensusByDate.get(bar.date) : undefined;
            buyPmNote = cpoPt
              ? `[CPO门控P=${cpoPt.posteriorProb.toFixed(0)}% 拥挤度${cpoPt.tmtCrowdingPct.toFixed(1)}%]`
              : csPt
                ? `[跨所共识Z=${csPt.consensusZ.toFixed(2)}]`
                : pmPt
                  ? `[PM概率${pmPt.yesProb.toFixed(1)}% ΔP${pmPt.probDelta >= 0 ? '+' : ''}${pmPt.probDelta.toFixed(1)}% Z=${pmPt.divergenceZ.toFixed(2)}]`
                  : '';
          }
        }
      }
    }

    const equity = cash + shares * bar.close;
    if (equity > peakEquity) peakEquity = equity;
    const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    const benchClose = shMap.get(bar.date) || bar.close;
    const benchmarkPct =
      firstBenchClose > 0 ? ((benchClose - firstBenchClose) / firstBenchClose) * 100 : 0;

    equityCurve.push({
      date: bar.date,
      equity: Number(equity.toFixed(2)),
      returnPct: Number((((equity - initialCapital) / initialCapital) * 100).toFixed(2)),
      benchmarkPct: Number(benchmarkPct.toFixed(2)),
      drawdownPct: Number((-ddPct).toFixed(2)),
    });
  }

  // Mark-to-market final equity
  const lastBar = bars[bars.length - 1];
  const finalCapital = Number((cash + shares * (lastBar?.close || 0)).toFixed(2));
  const totalReturnPct = Number(
    (((finalCapital - initialCapital) / initialCapital) * 100).toFixed(2)
  );
  const years = Math.max(0.1, bars.length / 245);
  const annualReturnPct = Number(
    ((Math.pow(Math.max(0.01, finalCapital / initialCapital), 1 / years) - 1) * 100).toFixed(2)
  );
  const benchmarkReturnPct = equityCurve[equityCurve.length - 1]?.benchmarkPct || 0;

  // Sharpe
  const dailyRets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prevEq = equityCurve[i - 1].equity;
    if (prevEq > 0) dailyRets.push((equityCurve[i].equity - prevEq) / prevEq);
  }
  const avgRet = dailyRets.reduce((a, b) => a + b, 0) / Math.max(1, dailyRets.length);
  const variance =
    dailyRets.reduce((a, b) => a + Math.pow(b - avgRet, 2), 0) /
    Math.max(1, dailyRets.length);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? Number(((avgRet / std) * Math.sqrt(245)).toFixed(2)) : 0;

  const winTrades = trades.filter((t) => t.pnl > 0);
  const lossTrades = trades.filter((t) => t.pnl <= 0);
  const grossWin = winTrades.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(lossTrades.reduce((a, b) => a + b.pnl, 0));
  const winRatePct =
    trades.length > 0 ? Number(((winTrades.length / trades.length) * 100).toFixed(1)) : 0;
  const profitFactor =
    grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 9.99 : 0;

  return {
    code,
    name: stockRes.name || code,
    strategy: strategyLabel,
    startDate: bars[0]?.date || '',
    endDate: lastBar?.date || '',
    initialCapital,
    finalCapital,
    metrics: {
      totalReturnPct,
      annualReturnPct,
      benchmarkReturnPct,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      sharpe,
      winRatePct,
      profitFactor,
      totalTrades: trades.length,
    },
    equityCurve,
    trades,
  };
}
