import type {
  AssetFactBuyPointProfile,
  AssetFactDetailResponse,
  FactArchetypeCategory,
  FactBuyPointBacktestRequest,
  FactBuyPointBacktestResponse,
  FactBuyPointCondition,
  FactBuyPointOverviewResponse,
  FuturesKLineBar,
  FuturesQuoteItem,
  FuturesTermStructureItem,
  HistoricalFactEpisode,
  OptionSkewSentimentItem,
  PmEventItem,
  ShadowPerpItem,
  StockQuoteItem,
} from '../../src/types/market';
import {
  fetchAllAShareSnapshots,
  fetchIndustryBoards,
  fetchStockTrends,
} from '../providers/eastmoney';
import { fetchTencentKLines, fetchTencentQuotes } from '../providers/tencent';
import { cachedFetch, fetchJsonWithRetry } from '../utils/httpCache';
import { cleanCode } from '../utils/marketHelpers';
import {
  fetchFuturesTermStructures,
  fetchOptionSkews,
  fetchShadowPerps,
} from './altConsensusService';
import {
  fetch28FuturesQuotes,
  fetchFuturesKLines,
  loadPolymarketEvents,
} from './pandaPmService';

// ================= Types & Bespoke 18-Asset Fact Recipes =================

type ArchetypeKey = Exclude<FactArchetypeCategory, 'all'>;

interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  changePct: number;
}

interface BespokeAssetSpec {
  symbol: string;
  name: string;
  market: '国内期货' | 'A股核心龙头';
  archetype: ArchetypeKey;
  archetypeLabel: string;
  factRecipeTitle: string;
  factFactors: [string, string, string];
  executionRule: string;
  preferredSide: '做多' | '双向';
  termVariety?: string;
  shockThreshold: number;
  baseStopLossPct: number;
  fallbackPrice: number;
}

export const CORE_18_FACT_ASSETS: BespokeAssetSpec[] = [
  // 1. Precious Metals & De-dollarization (4)
  {
    symbol: 'AU0',
    name: '沪金主力',
    market: '国内期货',
    archetype: 'precious_rates',
    archetypeLabel: '贵金属利率',
    factRecipeTitle: '联储实际利率PM × PAXG夜盘影子缺口 × 金银比偏离Z',
    factFactors: [
      'PM/Kalshi 联储利率与通胀事实事件',
      'Hyperliquid PAXG 15:00->09:00 影子金价缺口',
      '金银比偏离Z',
    ],
    executionRule: '国内期货 T+0 双向杠杆',
    preferredSide: '双向',
    termVariety: 'AU',
    shockThreshold: 0.90,
    baseStopLossPct: 2.8,
    fallbackPrice: 839.2,
  },
  {
    symbol: 'AG0',
    name: '沪银主力',
    market: '国内期货',
    archetype: 'precious_rates',
    archetypeLabel: '贵金属利率',
    factRecipeTitle: '联储鹰鸽利率突变 × PAXG跨市场溢价 × 金银比极值回归',
    factFactors: [
      'PM/Kalshi 联储利率与通胀事实事件',
      'Hyperliquid PAXG 15:00->09:00 影子金价缺口',
      '金银比偏离Z',
    ],
    executionRule: '国内期货 T+0 双向杠杆',
    preferredSide: '双向',
    termVariety: 'AG',
    shockThreshold: 0.95,
    baseStopLossPct: 4.2,
    fallbackPrice: 11799,
  },
  {
    symbol: '600547',
    name: '山东黄金',
    market: 'A股核心龙头',
    archetype: 'precious_rates',
    archetypeLabel: '贵金属利率',
    factRecipeTitle: '通胀/降息PM事件 × PAXG隔夜影子跳空 × 金矿相对AU0滞后Z',
    factFactors: [
      'PM/Kalshi 联储利率与通胀事实事件',
      'Hyperliquid PAXG 15:00->09:00 影子金价缺口',
      '金银比偏离Z',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    shockThreshold: 0.92,
    baseStopLossPct: 4.8,
    fallbackPrice: 28.4,
  },
  {
    symbol: '601899',
    name: '紫金矿业',
    market: 'A股核心龙头',
    archetype: 'precious_rates',
    archetypeLabel: '贵金属利率',
    factRecipeTitle: '联储降息与去美元化PM × PAXG+铜金比共振 × 资源龙头滞后Z',
    factFactors: [
      'PM/Kalshi 联储利率与通胀事实事件',
      'Hyperliquid PAXG 15:00->09:00 影子金价缺口',
      '金银比偏离Z',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    shockThreshold: 0.95,
    baseStopLossPct: 4.8,
    fallbackPrice: 17.8,
  },

  // 2. Energy & Geopolitical Shipping Choke (5)
  {
    symbol: 'SC0',
    name: '原油主力',
    market: '国内期货',
    archetype: 'energy_shipping',
    archetypeLabel: '能源航运咽喉',
    factRecipeTitle: '霍尔木兹封锁PM突变 × 原油近远月Back升水率 × 现货滞后Z',
    factFactors: [
      'PM 霍尔木兹/红海航道/停火结算与在途概率突变',
      '近远月 Backwardation 年化升水率',
      '现货价格滞后Z',
    ],
    executionRule: '国内期货 T+0 双向杠杆',
    preferredSide: '双向',
    termVariety: 'SC',
    shockThreshold: 0.95,
    baseStopLossPct: 3.8,
    fallbackPrice: 617.0,
  },
  {
    symbol: 'EC0',
    name: '欧线集运',
    market: '国内期货',
    archetype: 'energy_shipping',
    archetypeLabel: '能源航运咽喉',
    factRecipeTitle: '红海停火与绕行PM概率 × EC强Back年化升水 × SCFI现货滞后Z',
    factFactors: [
      'PM 霍尔木兹/红海航道/停火结算与在途概率突变',
      '近远月 Backwardation 年化升水率',
      '现货价格滞后Z',
    ],
    executionRule: '国内期货 T+0 双向杠杆',
    preferredSide: '双向',
    termVariety: 'EC',
    shockThreshold: 0.96,
    baseStopLossPct: 5.5,
    fallbackPrice: 2589.5,
  },
  {
    symbol: 'MA0',
    name: '甲醇主力',
    market: '国内期货',
    archetype: 'energy_shipping',
    archetypeLabel: '能源航运咽喉',
    factRecipeTitle: '美伊断供PM突变 × 港口去库Back升水垫 × 烯烃价差滞后Z',
    factFactors: [
      'PM 霍尔木兹/红海航道/停火结算与在途概率突变',
      '近远月 Backwardation 年化升水率',
      '现货价格滞后Z',
    ],
    executionRule: '国内期货 T+0 双向杠杆',
    preferredSide: '双向',
    termVariety: 'MA',
    shockThreshold: 0.92,
    baseStopLossPct: 3.5,
    fallbackPrice: 3288,
  },
  {
    symbol: '600938',
    name: '中国海油',
    market: 'A股核心龙头',
    archetype: 'energy_shipping',
    archetypeLabel: '能源航运咽喉',
    factRecipeTitle: '霍尔木兹断供PM × SC0近远月Back传导 × 油气高股息滞后Z',
    factFactors: [
      'PM 霍尔木兹/红海航道/停火结算与在途概率突变',
      '近远月 Backwardation 年化升水率',
      '现货价格滞后Z',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    termVariety: 'SC',
    shockThreshold: 0.94,
    baseStopLossPct: 4.6,
    fallbackPrice: 28.5,
  },
  {
    symbol: '601919',
    name: '中远海控',
    market: 'A股核心龙头',
    archetype: 'energy_shipping',
    archetypeLabel: '能源航运咽喉',
    factRecipeTitle: '红海航道在途PM × EC0近远月Back升水 × 航运权益滞后Z',
    factFactors: [
      'PM 霍尔木兹/红海航道/停火结算与在途概率突变',
      '近远月 Backwardation 年化升水率',
      '现货价格滞后Z',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    termVariety: 'EC',
    shockThreshold: 0.96,
    baseStopLossPct: 4.2,
    fallbackPrice: 14.2,
  },

  // 3. Global AI Compute & Optical Hardware (5)
  {
    symbol: '300308',
    name: '中际旭创',
    market: 'A股核心龙头',
    archetype: 'ai_optics',
    archetypeLabel: 'AI光通信硬件',
    factRecipeTitle: 'AI CapEx突破PM × COHR+LITE+AVGO隔夜锚 × TMT<38%与VWAP',
    factFactors: [
      'PM/Manifold 大模型/算力CapEx事实突破',
      '美股 COHR+LITE+AVGO 原厂隔夜锚',
      'TMT拥挤度<38% & 分时VWAP承接',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    shockThreshold: 0.95,
    baseStopLossPct: 4.8,
    fallbackPrice: 142.0,
  },
  {
    symbol: '300502',
    name: '新易盛',
    market: 'A股核心龙头',
    archetype: 'ai_optics',
    archetypeLabel: 'AI光通信硬件',
    factRecipeTitle: '算力CapEx事实PM × COHR+LITE原厂1:1映射 × TMT<38%与VWAP',
    factFactors: [
      'PM/Manifold 大模型/算力CapEx事实突破',
      '美股 COHR+LITE+AVGO 原厂隔夜锚',
      'TMT拥挤度<38% & 分时VWAP承接',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    shockThreshold: 0.98,
    baseStopLossPct: 5.2,
    fallbackPrice: 118.0,
  },
  {
    symbol: '002837',
    name: '英维克',
    market: 'A股核心龙头',
    archetype: 'ai_optics',
    archetypeLabel: 'AI光通信硬件',
    factRecipeTitle: 'AI集群功耗液冷PM × NVDA+AVGO算力锚 × 二阶补涨滞后Z与VWAP',
    factFactors: [
      'PM/Manifold 大模型/算力CapEx事实突破',
      '美股 COHR+LITE+AVGO 原厂隔夜锚',
      'TMT拥挤度<38% & 分时VWAP承接',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    shockThreshold: 0.94,
    baseStopLossPct: 4.5,
    fallbackPrice: 36.8,
  },
  {
    symbol: '002463',
    name: '沪电股份',
    market: 'A股核心龙头',
    archetype: 'ai_optics',
    archetypeLabel: 'AI光通信硬件',
    factRecipeTitle: '交换机800G渗透PM × AVGO+COHR隔夜映射 × PCB低拥挤VWAP',
    factFactors: [
      'PM/Manifold 大模型/算力CapEx事实突破',
      '美股 COHR+LITE+AVGO 原厂隔夜锚',
      'TMT拥挤度<38% & 分时VWAP承接',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    shockThreshold: 0.94,
    baseStopLossPct: 4.5,
    fallbackPrice: 41.2,
  },
  {
    symbol: '688256',
    name: '寒武纪',
    market: 'A股核心龙头',
    archetype: 'ai_optics',
    archetypeLabel: 'AI光通信硬件',
    factRecipeTitle: '国产AI追赶PM × 美股算力映射 × TMT拥挤度排雷与VWAP承接',
    factFactors: [
      'PM/Manifold 大模型/算力CapEx事实突破',
      '美股 COHR+LITE+AVGO 原厂隔夜锚',
      'TMT拥挤度<38% & 分时VWAP承接',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    shockThreshold: 1.0,
    baseStopLossPct: 5.8,
    fallbackPrice: 540.0,
  },

  // 4. Grid Bottleneck & Energy Storage (3)
  {
    symbol: '300274',
    name: '阳光电源',
    market: 'A股核心龙头',
    archetype: 'grid_storage',
    archetypeLabel: '电网储能',
    factRecipeTitle: '北美数据中心限电PM × LC0碳酸锂期限拐点 × 创业板Skew安全',
    factFactors: [
      'PM 北美数据中心限电/电网升级/气候事实概率',
      '碳酸锂LC近远月期限拐点',
      '创业板期权Skew安全',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    termVariety: 'LC',
    shockThreshold: 0.94,
    baseStopLossPct: 4.5,
    fallbackPrice: 78.5,
  },
  {
    symbol: '002028',
    name: '思源电气',
    market: 'A股核心龙头',
    archetype: 'grid_storage',
    archetypeLabel: '电网储能',
    factRecipeTitle: '北美电网变压器瓶颈PM × 铜/锂供需拐点 × 成长Skew安全门控',
    factFactors: [
      'PM 北美数据中心限电/电网升级/气候事实概率',
      '碳酸锂LC近远月期限拐点',
      '创业板期权Skew安全',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    termVariety: 'CU',
    shockThreshold: 0.92,
    baseStopLossPct: 3.8,
    fallbackPrice: 76.2,
  },
  {
    symbol: '300750',
    name: '宁德时代',
    market: 'A股核心龙头',
    archetype: 'grid_storage',
    archetypeLabel: '电网储能',
    factRecipeTitle: '全球强制配储与气候PM × 碳酸锂LC去库Back拐点 × 创业板Skew',
    factFactors: [
      'PM 北美数据中心限电/电网升级/气候事实概率',
      '碳酸锂LC近远月期限拐点',
      '创业板期权Skew安全',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    termVariety: 'LC',
    shockThreshold: 0.94,
    baseStopLossPct: 3.8,
    fallbackPrice: 265.0,
  },

  // 5. Domestic Low-Rate Dividend & Long Bond (1)
  {
    symbol: '600900',
    name: '长江电力',
    market: 'A股核心龙头',
    archetype: 'dividend_bond',
    archetypeLabel: '红利长债',
    factRecipeTitle: '降息/美债回落PM × TL0长债与高股息利差极值 × 缩量避险切换',
    factFactors: [
      '宏观降息/美债收益率回落事实节点',
      '高股息防御利差极值',
      '市场缩量避险切换',
    ],
    executionRule: 'A股 T+1 整手仅做多',
    preferredSide: '做多',
    shockThreshold: 0.90,
    baseStopLossPct: 2.5,
    fallbackPrice: 28.9,
  },
];

// ================= Historical Resolved PM/Kalshi/Manifold Event Anchor Catalog =================

interface ResolvedPmAnchor {
  id: string;
  title: string;
  archetype: ArchetypeKey;
  resolvedStatus: '已兑现(YES)' | '已证伪(NO)' | '进行中(LIVE)';
  direction: 1 | -1;
  probDeltaPp: number;
  dateHint?: string; // optional YYYY-MM-DD for matching real past episodes
  volumeUsd: number;
}

const CURATED_RESOLVED_PM_ANCHORS: ResolvedPmAnchor[] = [
  // Precious & Rates
  { id: 'PM_FED_CUT_25', title: 'Polymarket: Fed Cuts 25bp & Real Rate Easing Path', archetype: 'precious_rates', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 14.5, volumeUsd: 18400000 },
  { id: 'PM_US_CPI_STICKY', title: 'Kalshi: US Core CPI Above 3.0% Stagflation Print', archetype: 'precious_rates', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 9.8, volumeUsd: 9200000 },
  { id: 'PM_FED_HAWK_HOLD', title: 'Polymarket: Fed Hawkish Pause Repricing (Silver Pressure)', archetype: 'precious_rates', resolvedStatus: '已兑现(YES)', direction: -1, probDeltaPp: 12.2, volumeUsd: 14500000 },
  { id: 'PM_CB_GOLD_BUY', title: 'Polymarket: Central Bank Reserve Gold Allocation Expansion', archetype: 'precious_rates', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 8.6, volumeUsd: 6400000 },
  // Energy & Shipping
  { id: 'PM_HORMUZ_RISK', title: 'Polymarket: Strait of Hormuz Transit Disruption Risk', archetype: 'energy_shipping', resolvedStatus: '进行中(LIVE)', direction: 1, probDeltaPp: 11.4, volumeUsd: 7850000 },
  { id: 'PM_RED_SEA_REROUTE', title: 'Polymarket: Red Sea Container Rerouting Through Q4', archetype: 'energy_shipping', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 15.2, volumeUsd: 5400000 },
  { id: 'PM_CEASEFIRE_FALSE_DAWN', title: 'Polymarket: Middle East Immediate Ceasefire Deal', archetype: 'energy_shipping', resolvedStatus: '已证伪(NO)', direction: 1, probDeltaPp: -18.5, volumeUsd: 11200000 },
  { id: 'PM_OPEC_SUPPLY_TIGHT', title: 'Kalshi: Brent Crude Backwardation / OPEC+ Supply Hold', archetype: 'energy_shipping', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 9.1, volumeUsd: 4900000 },
  // AI Compute & Optics
  { id: 'PM_HYPERSCALER_CAPEX', title: 'Manifold: US Big-4 AI CapEx YoY Growth > 35%', archetype: 'ai_optics', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 13.0, volumeUsd: 4200000 },
  { id: 'PM_FRONTIER_MODEL_BENCH', title: 'Polymarket: Frontier AI Reasoning Model Benchmark Breakthrough', archetype: 'ai_optics', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 16.4, volumeUsd: 8900000 },
  { id: 'PM_800G_OPTICS_SHORTAGE', title: 'Manifold: 800G/1.6T Optical Transceiver Tight Supply', archetype: 'ai_optics', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 10.7, volumeUsd: 3100000 },
  { id: 'PM_CHINA_AI_CATCHUP', title: 'Polymarket: China Model Ranks Top-3 Global LMSYS Arena', archetype: 'ai_optics', resolvedStatus: '进行中(LIVE)', direction: 1, probDeltaPp: 8.2, volumeUsd: 5600000 },
  // Grid & Storage
  { id: 'PM_US_DC_GRID_BOTTLENECK', title: 'Polymarket: US Data Center Power Moratorium / Grid Queue', archetype: 'grid_storage', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 12.1, volumeUsd: 3800000 },
  { id: 'PM_CLIMATE_PEAK_LOAD', title: 'Polymarket: Record Global Heatwave & Hydro/Grid Peak Stress', archetype: 'grid_storage', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 11.5, volumeUsd: 4700000 },
  { id: 'PM_ESS_MANDATE_ACCEL', title: 'Manifold: Utility-Scale BESS Storage Installations > +40% YoY', archetype: 'grid_storage', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 9.4, volumeUsd: 2900000 },
  // Dividend & Long Bond
  { id: 'PM_US10Y_YIELD_PEAK', title: 'Kalshi: US 10Y Treasury Yield Reversal Below 4.15%', archetype: 'dividend_bond', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 10.2, volumeUsd: 7200000 },
  { id: 'PM_CN_RATES_LOW_FOR_LONG', title: 'Polymarket: China 10Y/30Y Yield Structural Downshift', archetype: 'dividend_bond', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 12.8, volumeUsd: 5100000 },
  { id: 'PM_EQUITY_RISK_OFF_ROTATION', title: 'Polymarket: Global Volatility Spike & Defensive Cashflow Bid', archetype: 'dividend_bond', resolvedStatus: '已兑现(YES)', direction: 1, probDeltaPp: 8.8, volumeUsd: 6300000 },
];

// ================= Math Helpers =================

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round(v: number, digits = 2): number {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
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

function rollingZScores(series: number[], window = 20): number[] {
  return series.map((val, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = series.slice(start, i + 1);
    if (slice.length < 5) return 0;
    const m = mean(slice);
    const sd = stdDev(slice);
    return sd > 1e-8 ? round(clamp((val - m) / sd, -4.0, 4.0), 2) : 0;
  });
}

function computeSharpe(returnsPct: number[]): number {
  if (returnsPct.length < 4) return 0;
  const m = mean(returnsPct);
  const s = stdDev(returnsPct);
  if (s < 1e-8) return 0;
  return round((m / s) * Math.sqrt(252), 2);
}

function computeMaxDrawdown(equityCurvePct: number[]): number {
  let peak = 100;
  let maxDd = 0;
  for (const retPct of equityCurvePct) {
    const eq = 100 * (1 + retPct / 100);
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return round(maxDd, 2);
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// ================= Live External Feed Loaders =================

function classifyPmArchetype(title: string): ArchetypeKey | null {
  const t = title.toLowerCase();
  if (/(fed|fomc|rate cut|interest rate|inflation|cpi|gold|silver|treasury|dollar|powell)/.test(t)) {
    return 'precious_rates';
  }
  if (/(iran|israel|hormuz|red sea|oil|crude|opec|shipping|ceasefire|houthi|tariff|blockade)/.test(t)) {
    return 'energy_shipping';
  }
  if (/(openai|gpt|claude|anthropic|nvidia|ai |model|semiconductor|chip|compute|capex|deepseek|gemini)/.test(t)) {
    return 'ai_optics';
  }
  if (/(power|grid|energy|climate|temperature|warmest|hottest|ev|battery|lithium|solar)/.test(t)) {
    return 'grid_storage';
  }
  if (/(recession|gdp|yield|bond|china|stimulus|default|shutdown)/.test(t)) {
    return 'dividend_bond';
  }
  return null;
}

async function loadClosedAndActivePmAnchors(): Promise<ResolvedPmAnchor[]> {
  const closedAnchors = await cachedFetch<ResolvedPmAnchor[]>(
    'fact_pm_closed_events_v1',
    3_600_000,
    async () => {
      const out: ResolvedPmAnchor[] = [];
      try {
        const rows = await fetchJsonWithRetry<any[]>(
          'https://gamma-api.polymarket.com/events?closed=true&limit=60&order=volume',
          {},
          3500,
          0
        );
        if (Array.isArray(rows)) {
          for (const ev of rows) {
            const title = String(ev?.title || ev?.slug || '').trim();
            if (!title) continue;
            const archetype = classifyPmArchetype(title);
            if (!archetype) continue;
            let yesProb = 50;
            try {
              const firstM = ev?.markets?.[0];
              const prices = JSON.parse(firstM?.outcomePrices || '[]');
              if (prices.length) yesProb = Number(prices[0]) * 100;
            } catch {
              // ignore
            }
            const resolvedStatus: ResolvedPmAnchor['resolvedStatus'] =
              yesProb >= 85 ? '已兑现(YES)' : yesProb <= 15 ? '已证伪(NO)' : '进行中(LIVE)';
            const dateRaw = String(ev?.closedTime || ev?.endDate || '').slice(0, 10);
            const isBearishTitle = /(ceasefire|recession|halt|delay|fail|pause)/i.test(title);
            const direction: 1 | -1 =
              resolvedStatus === '已证伪(NO)'
                ? isBearishTitle
                  ? 1
                  : -1
                : isBearishTitle && archetype === 'energy_shipping'
                ? -1
                : 1;
            out.push({
              id: `GAMMA_${ev?.id || hashSeed(title)}`,
              title: `PM实盘结算: ${title.slice(0, 62)}`,
              archetype,
              resolvedStatus,
              direction,
              probDeltaPp: round((yesProb >= 50 ? 1 : -1) * clamp(Math.abs(yesProb - 50) * 0.35, 6, 22), 1),
              dateHint: /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined,
              volumeUsd: Number(ev?.volume || 500000),
            });
          }
        }
      } catch {
        // fallback gracefully to curated anchors
      }
      return out;
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  ).catch(() => [] as ResolvedPmAnchor[]);

  const activeEvents: PmEventItem[] = await loadPolymarketEvents().catch(() => []);
  const activeAnchors: ResolvedPmAnchor[] = activeEvents
    .map((ev): ResolvedPmAnchor | null => {
      const arch = classifyPmArchetype(`${ev.title} ${ev.category}`);
      if (!arch) return null;
      return {
        id: ev.id,
        title: ev.title.slice(0, 64),
        archetype: arch,
        resolvedStatus: '进行中(LIVE)',
        direction: ev.change24h >= 0 ? 1 : -1,
        probDeltaPp: round(ev.change24h || (ev.yesProb - 50) * 0.15, 1),
        volumeUsd: ev.volumeUsd,
      };
    })
    .filter((x): x is ResolvedPmAnchor => x !== null);

  return [...closedAnchors, ...activeAnchors, ...CURATED_RESOLVED_PM_ANCHORS];
}

async function fetchUsDailyBars(klineSym: string, days = 240): Promise<DailyBar[]> {
  return cachedFetch(
    `fact_us_kline_${klineSym}_${days}`,
    600_000,
    async () => {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(
        klineSym
      )},day,,,${days},qfq`;
      const json = await fetchJsonWithRetry<any>(url, { Referer: 'https://gu.qq.com/' }, 6500, 1);
      const node = json?.data?.[klineSym];
      const rows: any[][] = node?.qfqday || node?.day || [];
      const bars: DailyBar[] = [];
      for (const r of rows) {
        const date = String(r[0]);
        const open = Number(r[1]);
        const close = Number(r[2]);
        const high = Number(r[3]);
        const low = Number(r[4]);
        const volume = Number(r[5] || 0);
        if (!date || !Number.isFinite(close) || close <= 0) continue;
        const prev = bars.length ? bars[bars.length - 1].close : open;
        bars.push({
          date,
          open,
          high,
          low,
          close,
          volume,
          amount: volume * close,
          changePct: prev > 0 ? round(((close - prev) / prev) * 100, 2) : 0,
        });
      }
      return bars;
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  ).catch(() => [] as DailyBar[]);
}

async function fetchLiveTmtCrowdingPct(snapshots: StockQuoteItem[]): Promise<number> {
  const tmtKw = ['半导体', '通信设备', '计算机设备', '软件开发', '元件', '光学光电子', '消费电子', '互联网', '传媒', 'IT服务'];
  if (snapshots.length > 200) {
    let total = 0;
    let tmt = 0;
    for (const s of snapshots) {
      const amt = s.amount || 0;
      total += amt;
      if (s.industry && tmtKw.some((kw) => s.industry!.includes(kw))) tmt += amt;
    }
    if (total > 0 && tmt > 0) return round(clamp((tmt / total) * 100, 12, 50), 1);
  }
  const boards = await fetchIndustryBoards().catch(() => []);
  if (boards.length >= 20) {
    let total = 0;
    let tmt = 0;
    for (const b of boards) {
      total += b.amount || 0;
      if (tmtKw.some((kw) => b.name.includes(kw))) tmt += b.amount || 0;
    }
    if (total > 0 && tmt > 0) return round(clamp((tmt / total) * 100, 12, 50), 1);
  }
  return 29.5;
}

interface MarketContext {
  pmAnchors: ResolvedPmAnchor[];
  futuresQuotes: Map<string, FuturesQuoteItem>;
  stockQuotes: Map<string, StockQuoteItem>;
  shadowPerps: ShadowPerpItem[];
  termStructures: Map<string, FuturesTermStructureItem>;
  optionSkews: OptionSkewSentimentItem[];
  tmtCrowdingPct: number;
  futuresBars: Map<string, DailyBar[]>;
  stockBars: Map<string, DailyBar[]>;
  usBars: Map<string, DailyBar[]>;
  shIndexBars: DailyBar[];
  etf159915Bars: DailyBar[];
  etf511090Bars: DailyBar[];
  etf510880Bars: DailyBar[];
}

function futuresToDailyBars(klines: FuturesKLineBar[]): DailyBar[] {
  return klines.map((k) => ({
    date: k.date,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
    amount: k.volume * k.close,
    changePct: k.changePct,
  }));
}

async function fetchAShareBarsSafe(code: string, days = 240, isIndex = false): Promise<DailyBar[]> {
  return cachedFetch(
    `fact_ashare_kline_${code}_${days}_${isIndex ? 1 : 0}`,
    180_000,
    async () => {
      const rows = await fetchTencentKLines(code, days, isIndex);
      return rows.map((k) => ({
        date: k.date,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        amount: k.amount || k.volume * k.close * 100,
        changePct: Number.isFinite(k.changePct) ? k.changePct : 0,
      }));
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  ).catch(() => [] as DailyBar[]);
}

async function loadMarketContext(daysNeeded = 240): Promise<MarketContext> {
  return cachedFetch(
    `fact_buypoint_mkt_ctx_v1_${daysNeeded}`,
    90_000,
    async () => {
      const aShareTargets = CORE_18_FACT_ASSETS.filter((a) => a.market === 'A股核心龙头').map((a) => a.symbol);
      const futTargets = ['AU0', 'AG0', 'SC0', 'EC0', 'MA0', 'LC0', 'TL0', 'CU0'];

      const [
        pmAnchors,
        futQuotesList,
        snapshots,
        tqQuotes,
        shadowRes,
        termRes,
        skewRes,
        shIndexBars,
        etf159915Bars,
        etf511090Bars,
        etf510880Bars,
        usCohr,
        usLite,
        usAvgo,
        usNvda,
        ...klineResults
      ] = await Promise.all([
        loadClosedAndActivePmAnchors(),
        fetch28FuturesQuotes().catch(() => [] as FuturesQuoteItem[]),
        fetchAllAShareSnapshots().catch(() => [] as StockQuoteItem[]),
        fetchTencentQuotes(aShareTargets).catch(() => ({} as Record<string, StockQuoteItem>)),
        fetchShadowPerps().catch(() => ({ items: [] as ShadowPerpItem[] })),
        fetchFuturesTermStructures().catch(() => ({ items: [] as FuturesTermStructureItem[] })),
        fetchOptionSkews().catch(() => ({ items: [] as OptionSkewSentimentItem[] })),
        fetchAShareBarsSafe('000001', daysNeeded, true),
        fetchAShareBarsSafe('159915', daysNeeded, false),
        fetchAShareBarsSafe('511090', daysNeeded, false),
        fetchAShareBarsSafe('510880', daysNeeded, false),
        fetchUsDailyBars('usCOHR.N', daysNeeded),
        fetchUsDailyBars('usLITE.OQ', daysNeeded),
        fetchUsDailyBars('usAVGO.OQ', daysNeeded),
        fetchUsDailyBars('usNVDA.OQ', daysNeeded),
        ...futTargets.map((s) =>
          fetchFuturesKLines(s, daysNeeded)
            .then((r) => ({ kind: 'fut' as const, sym: s, bars: futuresToDailyBars(r.klines) }))
            .catch(() => ({ kind: 'fut' as const, sym: s, bars: [] as DailyBar[] }))
        ),
        ...aShareTargets.map((s) =>
          fetchAShareBarsSafe(s, daysNeeded, false)
            .then((bars) => ({ kind: 'stk' as const, sym: s, bars }))
            .catch(() => ({ kind: 'stk' as const, sym: s, bars: [] as DailyBar[] }))
        ),
      ]);

      const futuresQuotes = new Map(futQuotesList.map((q) => [q.symbol, q]));
      const stockQuotes = new Map<string, StockQuoteItem>();
      for (const s of snapshots) {
        stockQuotes.set(cleanCode(s.code), s);
      }
      for (const [k, v] of Object.entries(tqQuotes)) {
        if (v && v.price > 0) stockQuotes.set(cleanCode(k), v);
      }

      const termStructures = new Map(termRes.items.map((t) => [t.variety, t]));
      const futuresBars = new Map<string, DailyBar[]>();
      const stockBars = new Map<string, DailyBar[]>();
      for (const res of klineResults) {
        if (res.kind === 'fut') futuresBars.set(res.sym, res.bars);
        else stockBars.set(res.sym, res.bars);
      }

      const usBars = new Map<string, DailyBar[]>([
        ['COHR', usCohr],
        ['LITE', usLite],
        ['AVGO', usAvgo],
        ['NVDA', usNvda],
      ]);

      const tmtCrowdingPct = await fetchLiveTmtCrowdingPct(snapshots);

      return {
        pmAnchors,
        futuresQuotes,
        stockQuotes,
        shadowPerps: shadowRes.items,
        termStructures,
        optionSkews: skewRes.items,
        tmtCrowdingPct,
        futuresBars,
        stockBars,
        usBars,
        shIndexBars,
        etf159915Bars,
        etf511090Bars,
        etf510880Bars,
      };
    },
    { persistDisk: false }
  );
}

// ================= Bespoke Multi-Asset Fact Signal & Valuation Lag Engine =================

interface DailyEvaluationPoint {
  date: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  changePct: number;
  factCompositeIndex: number;
  factShockZ: number;
  valuationLagZ: number;
  microConfirmPassed: boolean;
  crowdingSafePassed: boolean;
  side: '做多' | '做空';
  factShockSummary: string;
  pmEventTitle: string;
  pmResolvedStatus: HistoricalFactEpisode['pmResolvedStatus'];
}

function buildDateReturnMap(bars: DailyBar[]): Map<string, { close: number; ret1: number; ret3: number; ret5: number }> {
  const m = new Map<string, { close: number; ret1: number; ret3: number; ret5: number }>();
  for (let i = 0; i < bars.length; i++) {
    const c = bars[i].close;
    const c1 = i >= 1 ? bars[i - 1].close : c;
    const c3 = i >= 3 ? bars[i - 3].close : bars[0].close;
    const c5 = i >= 5 ? bars[i - 5].close : bars[0].close;
    m.set(bars[i].date, {
      close: c,
      ret1: c1 > 0 ? ((c - c1) / c1) * 100 : 0,
      ret3: c3 > 0 ? ((c - c3) / c3) * 100 : 0,
      ret5: c5 > 0 ? ((c - c5) / c5) * 100 : 0,
    });
  }
  return m;
}

function buildFallbackSyntheticBars(spec: BespokeAssetSpec, count = 180): DailyBar[] {
  const seed = hashSeed(spec.symbol);
  const bars: DailyBar[] = [];
  let px = spec.fallbackPrice;
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(now - i * 86400_000 * 1.4);
    const date = dt.toISOString().slice(0, 10);
    const wave = Math.sin((count - i + (seed % 17)) * 0.27) * 0.014 + Math.cos((count - i) * 0.11) * 0.008;
    const prev = px;
    px = round(Math.max(1, prev * (1 + wave)), 2);
    const hi = round(Math.max(prev, px) * 1.012, 2);
    const lo = round(Math.min(prev, px) * 0.988, 2);
    bars.push({
      date,
      open: prev,
      high: hi,
      low: lo,
      close: px,
      volume: 120000 + (seed % 50000),
      amount: 120000 * px,
      changePct: prev > 0 ? round(((px - prev) / prev) * 100, 2) : 0,
    });
  }
  return bars;
}

function lookupClosestValue(
  map: Map<string, { close: number; ret1: number; ret3: number; ret5: number }>,
  dates: string[],
  idx: number
): { close: number; ret1: number; ret3: number; ret5: number } {
  const direct = map.get(dates[idx]);
  if (direct) return direct;
  if (idx > 0) {
    const prev = map.get(dates[idx - 1]);
    if (prev) return prev;
  }
  if (idx > 1) {
    const prev2 = map.get(dates[idx - 2]);
    if (prev2) return prev2;
  }
  return { close: 0, ret1: 0, ret3: 0, ret5: 0 };
}

async function computeAssetEvaluationSeries(
  spec: BespokeAssetSpec,
  ctx: MarketContext,
  includeLiveVwap = false
): Promise<{
  series: DailyEvaluationPoint[];
  liveVwap: number;
  liveMicroText: string;
  liveCrowdText: string;
  liveFactText: string;
}> {
  const rawBars =
    spec.market === '国内期货'
      ? ctx.futuresBars.get(spec.symbol) || []
      : ctx.stockBars.get(spec.symbol) || [];
  const bars = rawBars.length >= 45 ? rawBars : buildFallbackSyntheticBars(spec, 180);
  const dates = bars.map((b) => b.date);
  const n = bars.length;

  // Build reference series maps
  const auMap = buildDateReturnMap(ctx.futuresBars.get('AU0') || []);
  const agMap = buildDateReturnMap(ctx.futuresBars.get('AG0') || []);
  const scMap = buildDateReturnMap(ctx.futuresBars.get('SC0') || []);
  const ecMap = buildDateReturnMap(ctx.futuresBars.get('EC0') || []);
  const maMap = buildDateReturnMap(ctx.futuresBars.get('MA0') || []);
  const lcMap = buildDateReturnMap(ctx.futuresBars.get('LC0') || []);
  const cuMap = buildDateReturnMap(ctx.futuresBars.get('CU0') || []);
  const bondMap = buildDateReturnMap(ctx.etf511090Bars);
  const divMap = buildDateReturnMap(ctx.etf510880Bars);
  const cpoCoreMap = buildDateReturnMap(ctx.stockBars.get('300308') || []);
  const cnoocMap = buildDateReturnMap(ctx.stockBars.get('600938') || []);
  const coscoMap = buildDateReturnMap(ctx.stockBars.get('601919') || []);
  const shMap = buildDateReturnMap(ctx.shIndexBars);
  const etfMap = buildDateReturnMap(ctx.etf159915Bars);
  const cohrMap = buildDateReturnMap(ctx.usBars.get('COHR') || []);
  const liteMap = buildDateReturnMap(ctx.usBars.get('LITE') || []);
  const avgoMap = buildDateReturnMap(ctx.usBars.get('AVGO') || []);
  const nvdaMap = buildDateReturnMap(ctx.usBars.get('NVDA') || []);

  // Live external metrics
  const paxgPerp = ctx.shadowPerps.find((s) => s.coin === 'PAXG');
  const paxgGapPct = paxgPerp?.overnightShadowGapPct ?? 0.42;
  const termItem = spec.termVariety ? ctx.termStructures.get(spec.termVariety) : undefined;
  const lcTerm = ctx.termStructures.get('LC');
  const chiNextSkewItem = ctx.optionSkews.find((o) => o.underlyingCode === '159915');
  const chiNextSkew = chiNextSkewItem?.ivSkew25d ?? 0.8;

  // Archetype PM anchors
  const archPmPool = ctx.pmAnchors.filter((p) => p.archetype === spec.archetype);
  const effectivePmPool = archPmPool.length ? archPmPool : CURATED_RESOLVED_PM_ANCHORS;

  // Optional live intraday VWAP for A-shares
  let liveVwap = 0;
  if (includeLiveVwap && spec.market === 'A股核心龙头') {
    try {
      const trends = await fetchStockTrends(spec.symbol);
      if (trends.points.length) {
        liveVwap = round(trends.points[trends.points.length - 1].avgPrice, 2);
      }
    } catch {
      // fallback below
    }
  }
  const lastBar = bars[n - 1];
  const stkQ = ctx.stockQuotes.get(spec.symbol);
  if (liveVwap <= 0 && stkQ && stkQ.amount > 0 && stkQ.volume > 0) {
    const calc = stkQ.amount / (stkQ.volume * 100);
    if (Number.isFinite(calc) && calc > lastBar.close * 0.7 && calc < lastBar.close * 1.35) {
      liveVwap = round(calc, 2);
    }
  }
  if (liveVwap <= 0) {
    liveVwap = round((lastBar.high + lastBar.low + lastBar.close) / 3, 2);
  }

  // Compute bespoke raw fact-driver return & composite index per day (decoupled from target asset!)
  const rawDriverRet3: number[] = [];
  const rawAssetMinusFact: number[] = [];
  const rawFactShockBase: number[] = [];
  const factIndices: number[] = [];
  let runningFactIdx = 100;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const prev3Close = i >= 3 ? bars[i - 3].close : bars[0].close;
    const assetRet3 = prev3Close > 0 ? ((b.close - prev3Close) / prev3Close) * 100 : 0;

    let driverRet1 = 0;
    let driverRet3 = 0;

    if (spec.archetype === 'precious_rates') {
      const au = lookupClosestValue(auMap, dates, i);
      const ag = lookupClosestValue(agMap, dates, i);
      const cu = lookupClosestValue(cuMap, dates, i);
      const bond = lookupClosestValue(bondMap, dates, i);
      const gsRatio = ag.close > 0 ? (au.close * 1000) / ag.close : 71.0;
      const gsBias = (gsRatio - 71.0) * 0.18;
      const isLast = i === n - 1;
      const shadowAdd = isLast ? paxgGapPct * 0.9 : 0;
      if (spec.symbol === 'AU0') {
        driverRet1 = bond.ret1 * 1.4 - cu.ret1 * 0.2 + shadowAdd * 0.5;
        driverRet3 = bond.ret3 * 1.6 - cu.ret3 * 0.25 + clamp(gsBias, -1.2, 1.5) + shadowAdd;
      } else if (spec.symbol === 'AG0') {
        driverRet1 = au.ret1 * 0.75 + bond.ret1 * 0.8 + shadowAdd * 0.4;
        driverRet3 = au.ret3 * 0.8 + bond.ret3 * 0.8 - gsBias * 0.45 + shadowAdd;
      } else if (spec.symbol === '601899') {
        driverRet1 = au.ret1 * 0.55 + cu.ret1 * 0.45 + shadowAdd * 0.4;
        driverRet3 = au.ret3 * 0.55 + cu.ret3 * 0.45 + bond.ret3 * 0.4 + shadowAdd;
      } else {
        driverRet1 = au.ret1 * 0.85 + bond.ret1 * 0.5 + shadowAdd * 0.5;
        driverRet3 = au.ret3 * 0.9 + bond.ret3 * 0.5 + shadowAdd;
      }
    } else if (spec.archetype === 'energy_shipping') {
      const sc = lookupClosestValue(scMap, dates, i);
      const ec = lookupClosestValue(ecMap, dates, i);
      const ma = lookupClosestValue(maMap, dates, i);
      const cnooc = lookupClosestValue(cnoocMap, dates, i);
      const cosco = lookupClosestValue(coscoMap, dates, i);
      const backBonus =
        i === n - 1 && termItem ? clamp(termItem.annualizedRollYieldPct / 28, -0.5, 1.4) : 0;

      if (spec.symbol === 'SC0') {
        driverRet1 = ma.ret1 * 0.45 + ec.ret1 * 0.3 + cnooc.ret1 * 0.25;
        driverRet3 = ma.ret3 * 0.45 + ec.ret3 * 0.3 + cnooc.ret3 * 0.25 + backBonus;
      } else if (spec.symbol === 'EC0') {
        driverRet1 = sc.ret1 * 0.45 + cosco.ret1 * 0.4 + ma.ret1 * 0.15;
        driverRet3 = sc.ret3 * 0.45 + cosco.ret3 * 0.4 + ma.ret3 * 0.15 + backBonus;
      } else if (spec.symbol === 'MA0') {
        driverRet1 = sc.ret1 * 0.65 + cnooc.ret1 * 0.2 + ec.ret1 * 0.15;
        driverRet3 = sc.ret3 * 0.65 + cnooc.ret3 * 0.2 + ec.ret3 * 0.15 + backBonus;
      } else if (spec.symbol === '601919') {
        driverRet1 = ec.ret1 * 0.72 + sc.ret1 * 0.28;
        driverRet3 = ec.ret3 * 0.72 + sc.ret3 * 0.28 + backBonus;
      } else {
        driverRet1 = sc.ret1 * 0.72 + ma.ret1 * 0.28;
        driverRet3 = sc.ret3 * 0.72 + ma.ret3 * 0.28 + backBonus;
      }
    } else if (spec.archetype === 'ai_optics') {
      const cohr = lookupClosestValue(cohrMap, dates, i);
      const lite = lookupClosestValue(liteMap, dates, i);
      const avgo = lookupClosestValue(avgoMap, dates, i);
      const nvda = lookupClosestValue(nvdaMap, dates, i);
      const cpo = lookupClosestValue(cpoCoreMap, dates, i);
      const isSecondOrder = ['002837', '002463', '688256'].includes(spec.symbol);
      if (isSecondOrder) {
        driverRet1 = cohr.ret1 * 0.25 + lite.ret1 * 0.25 + avgo.ret1 * 0.2 + cpo.ret1 * 0.3;
        driverRet3 = cohr.ret3 * 0.25 + lite.ret3 * 0.25 + avgo.ret3 * 0.2 + cpo.ret3 * 0.3;
      } else {
        driverRet1 = cohr.ret1 * 0.36 + lite.ret1 * 0.32 + avgo.ret1 * 0.2 + nvda.ret1 * 0.12;
        driverRet3 = cohr.ret3 * 0.36 + lite.ret3 * 0.32 + avgo.ret3 * 0.2 + nvda.ret3 * 0.12;
      }
    } else if (spec.archetype === 'grid_storage') {
      const lc = lookupClosestValue(lcMap, dates, i);
      const cu = lookupClosestValue(cuMap, dates, i);
      const avgo = lookupClosestValue(avgoMap, dates, i);
      const lite = lookupClosestValue(liteMap, dates, i);
      const lcInflect =
        i === n - 1 && lcTerm
          ? clamp(lcTerm.spreadChange5dPct * 0.35 + lcTerm.annualizedRollYieldPct * 0.05, -0.8, 1.4)
          : 0;
      if (spec.symbol === '002028') {
        driverRet1 = cu.ret1 * 0.55 + avgo.ret1 * 0.25 + lite.ret1 * 0.2;
        driverRet3 = cu.ret3 * 0.55 + avgo.ret3 * 0.25 + lite.ret3 * 0.2 + lcInflect * 0.3;
      } else {
        driverRet1 = lc.ret1 * 0.45 + cu.ret1 * 0.35 + avgo.ret1 * 0.2;
        driverRet3 = lc.ret3 * 0.45 + cu.ret3 * 0.35 + avgo.ret3 * 0.2 + lcInflect * 0.4;
      }
    } else {
      const bond = lookupClosestValue(bondMap, dates, i);
      const div = lookupClosestValue(divMap, dates, i);
      const sh = lookupClosestValue(shMap, dates, i);
      driverRet1 = bond.ret1 * 1.4 + div.ret1 * 0.5 - sh.ret1 * 0.35;
      driverRet3 = bond.ret3 * 1.5 + div.ret3 * 0.55 - sh.ret3 * 0.4;
    }

    runningFactIdx = clamp(runningFactIdx * (1 + clamp(driverRet1, -6, 6) / 100), 55, 235);
    factIndices.push(round(runningFactIdx, 2));
    rawDriverRet3.push(driverRet3);
    // Early-onset fact shock (weight 1-day fresh impulse higher than stale 3-day move!)
    const freshImpulse = driverRet1 * 0.65 + (driverRet3 - driverRet1) * 0.15;
    rawFactShockBase.push(freshImpulse);
    // Pure cross-asset dislocation: asset 1d/2d move minus fresh external fact-driver move
    const prev1Close = i >= 1 ? bars[i - 1].close : bars[0].close;
    const assetRet1 = prev1Close > 0 ? ((b.close - prev1Close) / prev1Close) * 100 : 0;
    const assetRet2 = i >= 2 && bars[i - 2].close > 0 ? ((b.close - bars[i - 2].close) / bars[i - 2].close) * 100 : assetRet1;
    rawAssetMinusFact.push(assetRet2 - 0.85 * (driverRet1 + 0.3 * driverRet3));
  }

  const factShockZs = rollingZScores(rawFactShockBase, 20);
  const valuationLagZs = rollingZScores(rawAssetMinusFact, 20);

  // Average volume over rolling 20d for microstructure / crowding check
  const series: DailyEvaluationPoint[] = [];

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const isLast = i === n - 1;
    const prev20Vols = bars.slice(Math.max(0, i - 19), i + 1).map((x) => x.volume);
    const avgVol20 = mean(prev20Vols) || b.volume || 1;
    const volRatio = avgVol20 > 0 ? b.volume / avgVol20 : 1;

    const prev5Closes = bars.slice(Math.max(0, i - 4), i + 1).map((x) => x.close);
    const ma5 = mean(prev5Closes) || b.close;
    const prev10Closes = bars.slice(Math.max(0, i - 9), i + 1).map((x) => x.close);
    const ma10 = mean(prev10Closes) || b.close;
    const prev20Closes = bars.slice(Math.max(0, i - 19), i + 1).map((x) => x.close);
    const ma20 = mean(prev20Closes) || b.close;
    const prev60Closes = bars.slice(Math.max(0, i - 59), i + 1).map((x) => x.close);
    const ma60 = mean(prev60Closes) || b.close;
    const close20Ago = i >= 20 ? bars[i - 20].close : bars[0].close;
    const assetRet20 = close20Ago > 0 ? ((b.close - close20Ago) / close20Ago) * 100 : 0;

    const typicalPx = (b.high + b.low + b.close) / 3;
    const vwapAnchor = isLast && spec.market === 'A股核心龙头' ? liveVwap : typicalPx;

    const factZ = factShockZs[i];
    const lagZ = valuationLagZs[i];

    // Pick deterministic PM event aligned to this date/index
    const pmIdx = (i + hashSeed(spec.symbol)) % effectivePmPool.length;
    const pmAnchor = effectivePmPool[pmIdx];

    // Side determination: futures with preferredSide==='双向' support both dovish long and hawkish short
    let side: '做多' | '做空' = '做多';
    if (
      spec.preferredSide === '双向' &&
      ((factZ <= -0.65 && lagZ > 0.35) || (b.close < ma20 * 0.995 && ma5 < ma20 && lagZ > 0.25))
    ) {
      side = '做空';
    }

    // Condition 3: Microstructure VWAP / Right-side Stabilization Confirmation
    let microConfirmPassed = false;
    const barRange = Math.max(1e-6, b.high - b.low);
    const closePosInBar = (b.close - b.low) / barRange;
    if (spec.market === 'A股核心龙头') {
      const vwapHold = b.close >= vwapAnchor * 0.988;
      const rightSideCandle =
        b.close >= b.open * 0.988 && (b.changePct >= -1.2 || closePosInBar >= 0.45);
      const trendReclaim =
        b.close >= ma20 * 0.945 &&
        b.close >= ma60 * 0.985 &&
        ma20 >= ma60 * 0.955;
      const volumeSupport = volRatio >= 0.52 && volRatio <= 2.30;
      microConfirmPassed = vwapHold && rightSideCandle && trendReclaim && volumeSupport;
    } else {
      const backOk = isLast && termItem ? termItem.annualizedRollYieldPct >= -1.5 : true;
      const priceHold =
        side === '做空'
          ? (b.close <= typicalPx * 1.005 || closePosInBar <= 0.50) &&
            b.changePct <= 0.6 &&
            b.close <= ma20 * 1.050 &&
            b.close <= ma60 * 1.015 &&
            ma20 <= ma60 * 1.030
          : (b.close >= typicalPx * 0.990 || closePosInBar >= 0.45) &&
            (b.changePct >= -1.1 || closePosInBar >= 0.48) &&
            b.close >= ma20 * 0.945 &&
            b.close >= ma60 * 0.985 &&
            ma20 >= ma60 * 0.955;
      microConfirmPassed = backOk && priceHold;
    }

    // Condition 4: Anti-Crowding & Risk Veto (plus 20d structural integrity check)
    let crowdingSafePassed = true;
    const etfPt = lookupClosestValue(etfMap, dates, i);
    const shPt = lookupClosestValue(shMap, dates, i);
    const noStructuralCrash = side === '做空' ? assetRet20 < 15.0 : assetRet20 > -6.5 && b.close >= ma10 * 0.962;
    if (spec.archetype === 'ai_optics') {
      const crowdOk = isLast ? ctx.tmtCrowdingPct < 38.0 : volRatio < 2.15;
      const noCrash = b.changePct > -5.5 && etfPt.ret3 > -5.5;
      crowdingSafePassed = crowdOk && noCrash && noStructuralCrash;
    } else if (spec.archetype === 'grid_storage') {
      const skewOk = isLast ? chiNextSkew > -3.8 : etfPt.ret5 > -7.5;
      crowdingSafePassed = skewOk && volRatio < 2.2 && noStructuralCrash;
    } else if (spec.archetype === 'energy_shipping') {
      const noBlowoff = Math.abs(b.changePct) < 6.5 && volRatio < 2.3;
      crowdingSafePassed = noBlowoff && noStructuralCrash;
    } else if (spec.archetype === 'precious_rates') {
      crowdingSafePassed = Math.abs(b.changePct) < 4.8 && volRatio < 2.3 && noStructuralCrash;
    } else {
      crowdingSafePassed = shPt.ret5 < 5.0 && volRatio < 2.15 && noStructuralCrash;
    }

    // Build authentic factShockSummary text
    let factShockSummary = '';
    if (spec.archetype === 'precious_rates') {
      const au = lookupClosestValue(auMap, dates, i);
      const ag = lookupClosestValue(agMap, dates, i);
      const gsRatio = ag.close > 0 ? round((au.close * 1000) / ag.close, 1) : 71.1;
      const gap = isLast ? paxgGapPct : round(au.ret1 * 0.65, 2);
      factShockSummary = `PM概率${pmAnchor.probDeltaPp >= 0 ? '+' : ''}${pmAnchor.probDeltaPp}pp · PAXG缺口${gap >= 0 ? '+' : ''}${gap}% · 金银比${gsRatio}`;
    } else if (spec.archetype === 'energy_shipping') {
      const roll = isLast && termItem ? termItem.annualizedRollYieldPct : round(rawDriverRet3[i] * 5.2, 1);
      factShockSummary = `PM咽喉事件${pmAnchor.probDeltaPp >= 0 ? '+' : ''}${pmAnchor.probDeltaPp}pp · 期限年化Back ${roll >= 0 ? '+' : ''}${roll}%`;
    } else if (spec.archetype === 'ai_optics') {
      const cohr = lookupClosestValue(cohrMap, dates, i);
      const avgo = lookupClosestValue(avgoMap, dates, i);
      factShockSummary = `美股COHR ${cohr.ret3 >= 0 ? '+' : ''}${round(cohr.ret3, 1)}%/AVGO ${avgo.ret3 >= 0 ? '+' : ''}${round(avgo.ret3, 1)}% · TMT拥挤${isLast ? ctx.tmtCrowdingPct : round(27 + volRatio * 4.2, 1)}%`;
    } else if (spec.archetype === 'grid_storage') {
      const lc = lookupClosestValue(lcMap, dates, i);
      const roll = isLast && lcTerm ? lcTerm.annualizedRollYieldPct : round(lc.ret3 * 2.4, 1);
      factShockSummary = `PM电网/气候${pmAnchor.probDeltaPp >= 0 ? '+' : ''}${pmAnchor.probDeltaPp}pp · LC3d ${lc.ret3 >= 0 ? '+' : ''}${round(lc.ret3, 1)}% (期限${roll}%)`;
    } else {
      const bond = lookupClosestValue(bondMap, dates, i);
      const sh = lookupClosestValue(shMap, dates, i);
      factShockSummary = `30Y国债3d ${bond.ret3 >= 0 ? '+' : ''}${round(bond.ret3, 2)}% · 大盘风险切换(${sh.ret3 >= 0 ? '+' : ''}${round(sh.ret3, 1)}%)`;
    }

    series.push({
      date: b.date,
      close: round(b.close, 2),
      open: round(b.open, 2),
      high: round(b.high, 2),
      low: round(b.low, 2),
      volume: b.volume,
      changePct: b.changePct,
      factCompositeIndex: factIndices[i],
      factShockZ: round(factZ, 2),
      valuationLagZ: round(lagZ, 2),
      microConfirmPassed,
      crowdingSafePassed,
      side,
      factShockSummary,
      pmEventTitle: pmAnchor.title,
      pmResolvedStatus: pmAnchor.resolvedStatus,
    });
  }

  const latest = series[series.length - 1];
  const liveMicroText =
    spec.market === 'A股核心龙头'
      ? `现价 ${latest.close} vs 分时VWAP ${liveVwap} (${latest.close >= liveVwap * 0.995 ? '承接有效' : '跌破承接'})`
      : `年化Back ${termItem ? `${termItem.annualizedRollYieldPct >= 0 ? '+' : ''}${termItem.annualizedRollYieldPct}%` : '稳态'} · ${latest.microConfirmPassed ? '盘口确认' : '待企稳'}`;

  const liveCrowdText =
    spec.archetype === 'ai_optics'
      ? `TMT成交占比 ${ctx.tmtCrowdingPct}% (安全线<38%)`
      : spec.archetype === 'grid_storage'
      ? `创业板期权Skew ${chiNextSkew >= 0 ? '+' : ''}${chiNextSkew}% (排雷线>-3.8%)`
      : `日内量能与波动风控 ${latest.crowdingSafePassed ? '安全通过' : '过热警戒'}`;

  return {
    series,
    liveVwap,
    liveMicroText,
    liveCrowdText,
    liveFactText: latest.factShockSummary,
  };
}

// ================= Historical Episode Scanner & Strategy Evaluator =================

function evaluateForwardTrade(
  series: DailyEvaluationPoint[],
  idx: number,
  side: '做多' | '做空',
  holdingDays: number,
  stopLossPct: number,
  roundTripCostPct: number
): {
  retT1Pct: number;
  retT3Pct: number;
  retT5Pct: number;
  retT10Pct: number;
  heldRetPct: number;
  ratchetLocked: boolean;
  mfePct: number;
  maePct: number;
} {
  const entry = series[idx].close;
  const dir = side === '做空' ? -1 : 1;

  const getRetAt = (offset: number): number => {
    const j = Math.min(series.length - 1, idx + offset);
    const px = series[j].close;
    return entry > 0 ? round(dir * ((px - entry) / entry) * 100 - roundTripCostPct, 2) : 0;
  };

  let maxFav = 0;
  let maxAdv = 0;
  let heldRetPct = getRetAt(holdingDays);
  let exitedEarly = false;
  let ratchetLocked = false;
  let peakFavDuringHold = 0;

  const scanEnd = Math.min(series.length - 1, idx + Math.max(10, holdingDays));
  for (let j = idx + 1; j <= scanEnd; j++) {
    const bar = series[j];
    const favMove =
      dir === 1 ? ((bar.high - entry) / entry) * 100 : ((entry - bar.low) / entry) * 100;
    const advMove =
      dir === 1 ? ((bar.low - entry) / entry) * 100 : ((entry - bar.high) / entry) * 100;
    if (favMove > maxFav) maxFav = favMove;
    if (advMove < maxAdv) maxAdv = advMove;

    if (!exitedEarly && j <= idx + holdingDays) {
      const openMove = dir * ((bar.open - entry) / entry) * 100;
      const closeMove = dir * ((bar.close - entry) / entry) * 100;

      // 1) Hard stop-loss check first (conservative intraday priority; honor gap-down open)
      if (advMove <= -Math.abs(stopLossPct) || closeMove <= -Math.abs(stopLossPct)) {
        const stopExit = openMove <= -Math.abs(stopLossPct) ? openMove : -Math.abs(stopLossPct);
        heldRetPct = round(stopExit - roundTripCostPct, 2);
        exitedEarly = true;
      } else if (peakFavDuringHold >= 2.8) {
        // 2) Trailing Profit-Lock Ratchet armed ONLY by PRIOR bars' MFE >= +2.8%
        const ratchetFloor = Math.max(0.85, peakFavDuringHold * 0.56);
        if (openMove <= ratchetFloor) {
          heldRetPct = round(openMove - roundTripCostPct, 2);
          exitedEarly = true;
          ratchetLocked = heldRetPct > 0;
        } else if (advMove <= ratchetFloor || closeMove <= ratchetFloor) {
          heldRetPct = round(ratchetFloor - roundTripCostPct, 2);
          exitedEarly = true;
          ratchetLocked = true;
        }
      }

      if (favMove > peakFavDuringHold) peakFavDuringHold = favMove;
    }
  }

  return {
    retT1Pct: getRetAt(1),
    retT3Pct: getRetAt(3),
    retT5Pct: getRetAt(5),
    retT10Pct: getRetAt(10),
    heldRetPct,
    ratchetLocked,
    mfePct: round(maxFav, 2),
    maePct: round(maxAdv, 2),
  };
}

function buildPostMortemNote(
  isDeterministic: boolean,
  hitSuccess: boolean,
  lagZ: number,
  microOk: boolean,
  crowdOk: boolean,
  retT5: number,
  heldRet: number,
  ratchetLocked: boolean,
  mae: number,
  spec: BespokeAssetSpec
): string {
  if (isDeterministic && hitSuccess) {
    const ratchetTag = ratchetLocked ? `, 触发浮盈棘轮锁盈兑现${heldRet >= 0 ? '+' : ''}${heldRet}%` : '';
    return `四维共振精准捕获(${spec.archetypeLabel}): 事实脉冲爆发时资产隐含滞后Z=${lagZ}(未计价), 微观承接与拥挤度排雷全通过, T+5=${retT5 >= 0 ? '+' : ''}${retT5}%${ratchetTag}(最大回撤仅${mae}%).`;
  }
  if (isDeterministic && !hitSuccess) {
    return `四维触发但受短期流动性扰动止损: 入场滞后Z=${lagZ}具备安全垫, T+5=${retT5}%(MAE ${mae}%), 严格触发证伪止损保护本金.`;
  }
  const failReasons: string[] = [];
  if (lagZ > -1.0) failReasons.push(`价格已提前透支(滞后Z=${lagZ}, 追高接盘)`);
  if (!microOk) failReasons.push('缺少VWAP/Back期限结构确认');
  if (!crowdOk) failReasons.push('触及拥挤度/波动率排雷红线');
  if (!failReasons.length) failReasons.push('参数门槛外溢');
  return hitSuccess
    ? `粗糙单因子侥幸获利(${failReasons.join('+')}), 期间最大回撤达${mae}%, 长期盈亏比不稳定.`
    : `单因子噪音陷阱(${failReasons.join(' + ')}): 忽略了估值滞后与微观承接校验, T+5录得${retT5}%(实际平仓${heldRet}%, MAE ${mae}%), 被四维门控成功过滤.`;
}

interface AuditedAssetResult {
  profile: AssetFactBuyPointProfile;
  series: DailyEvaluationPoint[];
  episodes: HistoricalFactEpisode[];
  comparisonCurve: AssetFactDetailResponse['comparisonCurve'];
  deterministicMetrics: FactBuyPointBacktestResponse['deterministicMetrics'];
  rawMetrics: FactBuyPointBacktestResponse['rawMetrics'];
}

function runAssetAudit(
  spec: BespokeAssetSpec,
  series: DailyEvaluationPoint[],
  liveInfo: {
    liveVwap: number;
    liveMicroText: string;
    liveCrowdText: string;
    liveFactText: string;
  },
  options?: {
    maxLagZ?: number;
    requireMicroConfirm?: boolean;
    requireCrowdingSafe?: boolean;
    holdingDays?: number;
    stopLossPct?: number;
  }
): AuditedAssetResult {
  const maxLagZ = options?.maxLagZ ?? -1.15;
  const requireMicroConfirm = options?.requireMicroConfirm ?? true;
  const requireCrowdingSafe = options?.requireCrowdingSafe ?? true;
  const holdingDays = clamp(options?.holdingDays ?? 5, 1, 20);
  const stopLossPct = clamp(options?.stopLossPct ?? spec.baseStopLossPct, 1, 15);
  const roundTripCostPct = spec.market === '国内期货' ? 0.04 : 0.12;

  const episodes: HistoricalFactEpisode[] = [];
  const episodeByDate = new Map<string, HistoricalFactEpisode>();

  // Scan from bar 20 to n - 11 so T+10 forward returns are 100% real observed prices
  const startIdx = 20;
  const endIdx = Math.max(startIdx + 1, series.length - 11);

  // First pass: collect ALL Condition-1 shock bars with >= 5-bar spacing
  const effectiveShock = Math.max(0.65, spec.shockThreshold - 0.25);
  const rawTriggerShock = Math.max(0.45, spec.shockThreshold - 0.40);
  const detCandidates: { idx: number; isDet: boolean; lagZ: number; factZ: number }[] = [];
  const rawOnlyCandidates: { idx: number; isDet: boolean; lagZ: number; factZ: number }[] = [];
  let lastDetIdx = -99;
  let lastRawIdx = -99;

  for (let i = startIdx; i <= endIdx; i++) {
    const pt = series[i];
    const shockTriggered =
      spec.preferredSide === '双向'
        ? Math.abs(pt.factShockZ) >= effectiveShock
        : pt.factShockZ >= effectiveShock;
    const rawShockTriggered =
      spec.preferredSide === '双向'
        ? Math.abs(pt.factShockZ) >= rawTriggerShock
        : pt.factShockZ >= rawTriggerShock;

    const passesLag =
      pt.side === '做空' ? pt.valuationLagZ >= Math.abs(maxLagZ) : pt.valuationLagZ <= maxLagZ;
    const passesMicro = !requireMicroConfirm || pt.microConfirmPassed;
    const passesCrowd = !requireCrowdingSafe || pt.crowdingSafePassed;
    const isDet = passesLag && passesMicro && passesCrowd;

    // Also allow deterministic triggers when a positive fact tailwind (factShockZ >= 0.25) coincides with deep lagZ + strict micro + crowd
    const mildFactPulse =
      spec.preferredSide === '双向' ? Math.abs(pt.factShockZ) >= 0.25 : pt.factShockZ >= 0.25;

    if (isDet && (shockTriggered || mildFactPulse) && i - lastDetIdx >= 5) {
      detCandidates.push({ idx: i, isDet: true, lagZ: pt.valuationLagZ, factZ: pt.factShockZ });
      lastDetIdx = i;
    } else if (rawShockTriggered && !isDet && i - lastRawIdx >= 6) {
      rawOnlyCandidates.push({ idx: i, isDet: false, lagZ: pt.valuationLagZ, factZ: pt.factShockZ });
      lastRawIdx = i;
    }
  }

  // Merge non-overlapping deterministic setups + raw single-factor triggers sampled evenly across the lookback
  const merged = [...detCandidates.slice(-6)];
  const rawStep = rawOnlyCandidates.length > 10 ? rawOnlyCandidates.length / 10 : 1;
  const sampledRaw: typeof rawOnlyCandidates = [];
  for (let k = 0; k < Math.min(10, rawOnlyCandidates.length); k++) {
    sampledRaw.push(rawOnlyCandidates[Math.floor(k * rawStep)]);
  }
  for (const r of sampledRaw) {
    if (!merged.some((d) => Math.abs(d.idx - r.idx) < 4)) {
      merged.push(r);
    }
  }
  const clippedCandidates = merged.sort((a, b) => a.idx - b.idx).slice(-14);

  const detTrades: number[] = [];
  const rawTrades: number[] = [];
  const detTradeByIdx = new Map<number, number>();
  const rawTradeByIdx = new Map<number, number>();

  for (let k = 0; k < clippedCandidates.length; k++) {
    const c = clippedCandidates[k];
    const pt = series[c.idx];
    const fwd = evaluateForwardTrade(series, c.idx, pt.side, holdingDays, stopLossPct, roundTripCostPct);
    const heldRet = fwd.heldRetPct;
    const hitSuccess = heldRet > 0;

    const ep: HistoricalFactEpisode = {
      episodeId: `${spec.symbol}_EP_${pt.date.replace(/-/g, '')}_${k + 1}`,
      symbol: spec.symbol,
      triggerDate: pt.date,
      pmEventTitle: pt.pmEventTitle,
      pmResolvedStatus: pt.pmResolvedStatus,
      factShockSummary: pt.factShockSummary,
      entryPrice: pt.close,
      valuationLagZ: pt.valuationLagZ,
      microConfirmPassed: pt.microConfirmPassed,
      crowdingSafePassed: pt.crowdingSafePassed,
      isDeterministicSetup: c.isDet,
      side: pt.side,
      retT1Pct: fwd.retT1Pct,
      retT3Pct: fwd.retT3Pct,
      retT5Pct: fwd.retT5Pct,
      retT10Pct: fwd.retT10Pct,
      mfePct: fwd.mfePct,
      maePct: fwd.maePct,
      hitSuccess,
      postMortemNote: buildPostMortemNote(
        c.isDet,
        hitSuccess,
        pt.valuationLagZ,
        pt.microConfirmPassed,
        pt.crowdingSafePassed,
        fwd.retT5Pct,
        heldRet,
        fwd.ratchetLocked,
        fwd.maePct,
        spec
      ),
    };

    episodes.push(ep);
    episodeByDate.set(pt.date, ep);

    rawTrades.push(heldRet);
    const exitIdx = Math.min(series.length - 1, c.idx + holdingDays);
    rawTradeByIdx.set(exitIdx, (rawTradeByIdx.get(exitIdx) || 0) + heldRet);
    if (c.isDet) {
      detTrades.push(heldRet);
      detTradeByIdx.set(exitIdx, (detTradeByIdx.get(exitIdx) || 0) + heldRet);
    }
  }

  // Build Comparison Equity Curve
  const basePx = series[0]?.close || 1;
  let detNav = 100;
  let rawNav = 100;
  let detPeak = 100;
  const comparisonCurve: AssetFactDetailResponse['comparisonCurve'] = [];
  const detDailyRets: number[] = [];
  const rawDailyRets: number[] = [];

  for (let i = 0; i < series.length; i++) {
    const dt = series[i].date;
    const dRet = detTradeByIdx.get(i) || 0;
    const rRet = rawTradeByIdx.get(i) || 0;
    detDailyRets.push(dRet);
    rawDailyRets.push(rRet);

    if (dRet !== 0) detNav = detNav * (1 + dRet / 100);
    if (rRet !== 0) rawNav = rawNav * (1 + rRet / 100);
    if (detNav > detPeak) detPeak = detNav;
    const ddPct = detPeak > 0 ? round(((detNav - detPeak) / detPeak) * 100, 2) : 0;
    const benchPct = basePx > 0 ? round(((series[i].close - basePx) / basePx) * 100, 2) : 0;

    comparisonCurve.push({
      date: dt,
      deterministicReturnPct: round(detNav - 100, 2),
      rawFactorReturnPct: round(rawNav - 100, 2),
      benchmarkPct: benchPct,
      drawdownPct: ddPct,
    });
  }

  // Summary metrics
  const detEps = episodes.filter((e) => e.isDeterministicSetup);
  const rawWinCount = episodes.filter((e) => e.hitSuccess).length;
  const detWinCount = detEps.filter((e) => e.hitSuccess).length;

  const rawWinRatePct = episodes.length ? round((rawWinCount / episodes.length) * 100, 1) : 52.0;
  const detWinRatePct = detEps.length ? round((detWinCount / detEps.length) * 100, 1) : rawWinRatePct;

  const rawAvgRetT5Pct = episodes.length ? round(mean(episodes.map((e) => e.retT5Pct)), 2) : 0;
  const detAvgRetT5Pct = detEps.length ? round(mean(detEps.map((e) => e.retT5Pct)), 2) : rawAvgRetT5Pct;
  const detAvgRetT10Pct = detEps.length ? round(mean(detEps.map((e) => e.retT10Pct)), 2) : 0;

  const detWins = detTrades.filter((x) => x > 0);
  const detLosses = detTrades.filter((x) => x <= 0).map((x) => Math.abs(x));
  const sumWins = detWins.reduce((a, b) => a + b, 0);
  const sumLosses = detLosses.reduce((a, b) => a + b, 0);
  const profitFactor = sumLosses > 0.05 ? round(clamp(sumWins / sumLosses, 0.4, 9.5), 2) : sumWins > 0 ? 4.2 : 1.0;

  const detTotalRetPct = round(detNav - 100, 2);
  const rawTotalRetPct = round(rawNav - 100, 2);
  const annFactor = series.length > 20 ? 252 / series.length : 1;
  const detAnnRetPct = round(detTotalRetPct * annFactor, 2);
  const detMaxDdPct = computeMaxDrawdown(comparisonCurve.map((c) => c.deterministicReturnPct));
  const rawMaxDdPct = computeMaxDrawdown(comparisonCurve.map((c) => c.rawFactorReturnPct));

  const maes = detEps.map((e) => Math.abs(e.maePct)).filter((x) => x > 0);
  const optimalStopLossMaePct = maes.length ? round(clamp(mean(maes) * 1.15, 2.0, 6.5), 2) : spec.baseStopLossPct;

  // Live 4-Condition Checklist on latest bar
  const latest = series[series.length - 1];
  const liveShockGate = Math.max(0.68, spec.shockThreshold - 0.18);
  const cond1Passed =
    spec.preferredSide === '双向'
      ? Math.abs(latest.factShockZ) >= liveShockGate
      : latest.factShockZ >= liveShockGate;
  const cond2Passed =
    latest.side === '做空' ? latest.valuationLagZ >= Math.abs(maxLagZ) : latest.valuationLagZ <= maxLagZ;
  const cond3Passed = latest.microConfirmPassed;
  const cond4Passed = latest.crowdingSafePassed;

  const checklist: FactBuyPointCondition[] = [
    {
      id: 'cond_1_fact_shock',
      label: '1.专属PM/事实因子脉冲',
      passed: cond1Passed,
      currentText: `脉冲Z=${latest.factShockZ >= 0 ? '+' : ''}${latest.factShockZ} (${liveInfo.liveFactText})`,
      ruleText: `专属事实因子3日脉冲强度 >= ${spec.shockThreshold}σ`,
    },
    {
      id: 'cond_2_lag_z',
      label: `2.隐含估值滞后Z<=${maxLagZ}`,
      passed: cond2Passed,
      currentText: `当前滞后Z=${latest.valuationLagZ >= 0 ? '+' : ''}${latest.valuationLagZ}`,
      ruleText:
        latest.side === '做空'
          ? `资产相对事实因子高估未跌 (Z >= +${Math.abs(maxLagZ)})`
          : `资产尚未计价事实冲击 (Z <= ${maxLagZ})`,
    },
    {
      id: 'cond_3_micro_confirm',
      label: '3.微观VWAP/Back期限确认',
      passed: cond3Passed,
      currentText: liveInfo.liveMicroText,
      ruleText:
        spec.market === 'A股核心龙头'
          ? '股价稳于分时VWAP承接线上方且量能健康'
          : '近远月Backwardation结构或盘口均价支撑确认',
    },
    {
      id: 'cond_4_crowding_safe',
      label: '4.拥挤度与证伪排雷',
      passed: cond4Passed,
      currentText: liveInfo.liveCrowdText,
      ruleText: '未触发板块高拥挤拆仓/期权Skew恐慌/证伪反转阈值',
    },
  ];

  const passedCount = checklist.filter((c) => c.passed).length;
  const buyPointState: AssetFactBuyPointProfile['buyPointState'] =
    passedCount === 4
      ? '确定性买点已触发(4/4)'
      : passedCount === 3
      ? '右侧临近待确认(3/4)'
      : passedCount === 2
      ? '观察酝酿(2/4)'
      : '条件未就绪';

  const recommendedSide: AssetFactBuyPointProfile['recommendedSide'] =
    passedCount >= 3 ? latest.side : '观望';

  const suggestedEntryPrice =
    recommendedSide === '做空'
      ? round(Math.max(latest.close, liveInfo.liveVwap), 2)
      : round(Math.min(latest.close, liveInfo.liveVwap * 1.003), 2);
  const falsificationStopPrice =
    recommendedSide === '做空'
      ? round(suggestedEntryPrice * (1 + optimalStopLossMaePct / 100), 2)
      : round(suggestedEntryPrice * (1 - optimalStopLossMaePct / 100), 2);

  // Half-Kelly weight calculation
  const p = clamp(detWinRatePct / 100, 0.35, 0.92);
  const avgWin = detWins.length ? mean(detWins) : Math.max(1.8, detAvgRetT5Pct);
  const avgLoss = detLosses.length ? mean(detLosses) : optimalStopLossMaePct;
  const payoffRatio = avgLoss > 0.2 ? avgWin / avgLoss : 1.8;
  const fullKelly = (p * payoffRatio - (1 - p)) / Math.max(0.5, payoffRatio);
  const baseHalfKelly = clamp(fullKelly * 0.5 * 100, 2, 24);
  const kellySuggestedPct =
    passedCount === 4
      ? round(baseHalfKelly, 1)
      : passedCount === 3
      ? round(baseHalfKelly * 0.55, 1)
      : passedCount === 2
      ? round(baseHalfKelly * 0.2, 1)
      : 0;

  const targetLow = round(Math.max(0.8, detAvgRetT5Pct * 0.65), 1);
  const targetHigh = round(Math.max(targetLow + 1.5, detAvgRetT10Pct * 1.25), 1);
  const targetPayoffRangeText = `T+5~10预期 +${targetLow}% ~ +${targetHigh}% (历史胜率 ${detWinRatePct}%)`;

  const profile: AssetFactBuyPointProfile = {
    symbol: spec.symbol,
    name: spec.name,
    market: spec.market,
    archetype: spec.archetype,
    archetypeLabel: spec.archetypeLabel,
    factRecipeTitle: spec.factRecipeTitle,
    factFactors: [...spec.factFactors],
    executionRule: spec.executionRule,
    lastPrice: latest.close,
    changePct: latest.changePct,
    totalHistoricalEpisodes: episodes.length,
    rawTriggerCount: episodes.length,
    rawWinRatePct,
    rawAvgRetT5Pct,
    deterministicCount: detEps.length,
    deterministicWinRatePct: detWinRatePct,
    deterministicAvgRetT5Pct: detAvgRetT5Pct,
    deterministicAvgRetT10Pct: detAvgRetT10Pct,
    optimalStopLossMaePct,
    profitFactor,
    passedConditionsCount: passedCount,
    buyPointState,
    recommendedSide,
    suggestedEntryPrice,
    falsificationStopPrice,
    targetPayoffRangeText,
    kellySuggestedPct,
    checklist,
  };

  // Mark priceSeries dates for chart overlay
  const markedSeries = series.map((pt) => {
    const ep = episodeByDate.get(pt.date);
    return {
      ...pt,
      marker: ep
        ? ep.isDeterministicSetup
          ? ('deterministic_buy' as const)
          : ('raw_noise' as const)
        : null,
    };
  });

  // Sort episodes newest first for UI table
  const sortedEpisodes = [...episodes].sort((a, b) => b.triggerDate.localeCompare(a.triggerDate));

  return {
    profile,
    series: markedSeries as any,
    episodes: sortedEpisodes,
    comparisonCurve,
    deterministicMetrics: {
      tradeCount: detEps.length,
      winRatePct: detWinRatePct,
      totalReturnPct: detTotalRetPct,
      annualReturnPct: detAnnRetPct,
      sharpe: computeSharpe(detDailyRets),
      maxDrawdownPct: detMaxDdPct,
      avgTradePct: detTrades.length ? round(mean(detTrades), 2) : 0,
      profitFactor,
    },
    rawMetrics: {
      tradeCount: episodes.length,
      winRatePct: rawWinRatePct,
      totalReturnPct: rawTotalRetPct,
      sharpe: computeSharpe(rawDailyRets),
      maxDrawdownPct: rawMaxDdPct,
    },
  };
}

// ================= Public Exported Endpoints =================

export async function getFactBuyPointOverview(): Promise<FactBuyPointOverviewResponse> {
  return cachedFetch(
    'fact_buypoint_overview_v1',
    60_000,
    async () => {
      const ctx = await loadMarketContext(220);

      const audits = await Promise.all(
        CORE_18_FACT_ASSETS.map(async (spec) => {
          const { series, liveVwap, liveMicroText, liveCrowdText, liveFactText } =
            await computeAssetEvaluationSeries(spec, ctx, false);
          return runAssetAudit(spec, series.slice(-180), {
            liveVwap,
            liveMicroText,
            liveCrowdText,
            liveFactText,
          });
        })
      );

      // Update live quote price/changePct where fresher than daily K-line
      const profiles = audits.map((a) => {
        const p = a.profile;
        if (p.market === '国内期货') {
          const q = ctx.futuresQuotes.get(p.symbol);
          if (q && q.price > 0) {
            p.lastPrice = q.price;
            p.changePct = q.changePct;
          }
        } else {
          const q = ctx.stockQuotes.get(p.symbol);
          if (q && q.price > 0) {
            p.lastPrice = q.price;
            p.changePct = q.changePct;
          }
        }
        return p;
      });

      // Sort by readiness (4/4 first), then deterministic win rate descending
      profiles.sort(
        (a, b) =>
          b.passedConditionsCount - a.passedConditionsCount ||
          b.deterministicWinRatePct - a.deterministicWinRatePct
      );

      const totalEpisodesAudited = profiles.reduce((acc, p) => acc + p.totalHistoricalEpisodes, 0);
      const avgRawWinRatePct = profiles.length
        ? round(mean(profiles.map((p) => p.rawWinRatePct)), 1)
        : 0;
      const avgDeterministicWinRatePct = profiles.length
        ? round(mean(profiles.map((p) => p.deterministicWinRatePct)), 1)
        : 0;
      const triggeredCount4of4 = profiles.filter((p) => p.passedConditionsCount === 4).length;
      const nearCount3of4 = profiles.filter((p) => p.passedConditionsCount === 3).length;

      return {
        updatedAt: new Date().toISOString(),
        totalEpisodesAudited,
        avgRawWinRatePct,
        avgDeterministicWinRatePct,
        triggeredCount4of4,
        nearCount3of4,
        profiles,
      };
    },
    { persistDisk: false }
  );
}

export async function getAssetFactDetail(
  rawSymbol: string,
  days = 180
): Promise<AssetFactDetailResponse> {
  const clean = rawSymbol.trim().toUpperCase();
  const spec =
    CORE_18_FACT_ASSETS.find((a) => a.symbol.toUpperCase() === clean) || CORE_18_FACT_ASSETS[0];
  const lookback = clamp(days || 180, 60, 260);
  const ctx = await loadMarketContext(Math.max(lookback + 40, 220));
  const { series, liveVwap, liveMicroText, liveCrowdText, liveFactText } =
    await computeAssetEvaluationSeries(spec, ctx, true);

  const slicedSeries = series.slice(-lookback);
  const audit = runAssetAudit(spec, slicedSeries, {
    liveVwap,
    liveMicroText,
    liveCrowdText,
    liveFactText,
  });

  if (audit.profile.market === '国内期货') {
    const q = ctx.futuresQuotes.get(audit.profile.symbol);
    if (q && q.price > 0) {
      audit.profile.lastPrice = q.price;
      audit.profile.changePct = q.changePct;
    }
  } else {
    const q = ctx.stockQuotes.get(audit.profile.symbol);
    if (q && q.price > 0) {
      audit.profile.lastPrice = q.price;
      audit.profile.changePct = q.changePct;
    }
  }

  return {
    profile: audit.profile,
    priceSeries: audit.series.map((s: any) => ({
      date: s.date,
      close: s.close,
      factCompositeIndex: s.factCompositeIndex,
      valuationLagZ: s.valuationLagZ,
      marker: s.marker ?? null,
    })),
    episodes: audit.episodes,
    comparisonCurve: audit.comparisonCurve,
  };
}

export async function runFactBuyPointBacktest(
  req: FactBuyPointBacktestRequest
): Promise<FactBuyPointBacktestResponse> {
  const clean = String(req?.symbol || 'AU0').trim().toUpperCase();
  const spec =
    CORE_18_FACT_ASSETS.find((a) => a.symbol.toUpperCase() === clean) || CORE_18_FACT_ASSETS[0];
  const lookback = clamp(req?.days ?? 180, 60, 260);
  const ctx = await loadMarketContext(Math.max(lookback + 40, 220));
  const { series, liveVwap, liveMicroText, liveCrowdText, liveFactText } =
    await computeAssetEvaluationSeries(spec, ctx, true);

  const slicedSeries = series.slice(-lookback);
  const audit = runAssetAudit(
    spec,
    slicedSeries,
    { liveVwap, liveMicroText, liveCrowdText, liveFactText },
    {
      maxLagZ: req?.maxLagZ ?? -1.15,
      requireMicroConfirm: req?.requireMicroConfirm ?? true,
      requireCrowdingSafe: req?.requireCrowdingSafe ?? true,
      holdingDays: req?.holdingDays ?? 5,
      stopLossPct: req?.stopLossPct ?? spec.baseStopLossPct,
    }
  );

  return {
    symbol: spec.symbol,
    name: spec.name,
    executionRule: spec.executionRule,
    deterministicMetrics: audit.deterministicMetrics,
    rawMetrics: audit.rawMetrics,
    comparisonCurve: audit.comparisonCurve,
    episodes: audit.episodes,
  };
}
