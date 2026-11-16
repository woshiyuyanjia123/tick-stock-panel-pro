export type NavTabId =
  | 'dashboard'
  | 'watchlist'
  | 'strategy'
  | 'factor'
  | 'backtest'
  | 'stock'
  | 'ladder'
  | 'concept'
  | 'industry'
  | 'finance'
  | 'monitor'
  | 'market-env'
  | 'anomaly'
  | 'panda-pm'
  | 'consensus-cpo'
  | 'fact-fupeng'
  | 'saas-desk';

export type EnvState = '强势' | '偏强' | '震荡' | '偏弱' | '弱势';

export interface DataSourceStatus {
  name: string;
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

export interface IndexQuote {
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  open?: number;
  high?: number;
  low?: number;
  prevClose?: number;
  volume?: number;
  amount?: number;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  tradingDate: string;
  isMarketOpen: boolean;
  serverTime: string;
  healthyCount: number;
  totalCount: number;
  dataSources: DataSourceStatus[];
  activeModel: string;
  indices: IndexQuote[];
}

export interface StockQuoteItem {
  code: string;
  name: string;
  market?: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  amount: number;
  turnoverRate: number;
  volumeRatio: number;
  marketCap?: number;
  floatMarketCap?: number;
  pe?: number;
  pb?: number;
  industry?: string;
}

export interface StockSearchItem {
  code: string;
  name: string;
  market: string;
  price?: number;
  changePct?: number;
  industry?: string;
}

export interface KLineBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  changePct: number;
  turnoverRate?: number;
  volRatio?: number;
  ma5?: number | null;
  ma10?: number | null;
  ma20?: number | null;
  ma60?: number | null;
  vol5?: number | null;
  vol10?: number | null;
  marker?: '板' | '炸' | '跌' | null;
}

export interface IntradayPoint {
  time: string;
  price: number;
  avgPrice: number;
  volume: number;
  changePct: number;
}

export interface FinancialPeriod {
  period: string;
  revenue: number;
  revenueYoY: number;
  netProfit: number;
  netProfitYoY: number;
  roe: number;
  grossMargin: number;
  debtRatio: number;
}

export interface StockDetailResponse {
  code: string;
  name: string;
  market: string;
  industry?: string;
  concepts?: string[];
  quote: StockQuoteItem;
  selectedDate: string;
  watchlistAdded: boolean;
  watchlistSince?: string;
  klines: KLineBar[];
  intraday: {
    date: string;
    prevClose: number;
    limitUpPrice: number;
    limitDownPrice: number;
    totalVolume: number;
    totalAmount: number;
    points: IntradayPoint[];
  };
  financials?: {
    reportDate: string;
    revenue: number;
    revenueYoY: number;
    netProfit: number;
    netProfitYoY: number;
    roe: number;
    grossMargin: number;
    debtRatio: number;
    eps: number;
    pe: number;
    pb: number;
    history: FinancialPeriod[];
  };
  diagnosis?: {
    totalScore: number;
    trendScore: number;
    volumeScore: number;
    chipScore: number;
    limitGeneScore: number;
    supportLevel: number;
    resistanceLevel: number;
    signals: string[];
  };
}

export interface SectorHotItem {
  code: string;
  name: string;
  changePct: number;
  stockCount?: number;
  leaderCode?: string;
  leaderName?: string;
  leaderChangePct?: number;
}

export interface AlertTriggerEvent {
  id: string;
  time: string;
  ruleId?: string;
  ruleName: string;
  code: string;
  name: string;
  message: string;
  level: 'info' | 'warn' | 'critical';
}

export interface DashboardData {
  date: string;
  resolvedDate: string;
  isMarketOpen: boolean;
  updatedAt: string;
  temperature: {
    score: number;
    label: string;
  };
  indices: IndexQuote[];
  breadth: {
    up: number;
    flat: number;
    down: number;
    total: number;
    upRate: number;
    strongCount: number;
    weakCount: number;
    limitUp: number;
    limitDown: number;
    sealRate: number;
    brokenCount: number;
    maxStreak: number;
    maxStreakStocks: { code: string; name: string }[];
    totalAmount: number;
    avgAmount?: number;
    avgTurnover: number;
    volumeRatio: number;
    highTurnoverCount: number;
    volExpansionRatio: number;
    avgChangePct: number;
    medianChangePct: number;
    dataNote?: string;
  };
  undertake: {
    status: string;
    summary: string;
    note?: string;
    timeframes: {
      label: string;
      subtitle: string;
      status: string;
      window: string;
      trend: 'up' | 'flat' | 'down';
      deltaPct?: number;
    }[];
    evidence: {
      indexPerf: string;
      volumeSupport: string;
      marketBreadth: string;
      sentimentVerify: string;
    };
    details?: string[];
  };
  distributionBuckets: {
    label: string;
    count: number;
    isPositive: boolean;
    isFlat?: boolean;
  }[];
  sentimentRadar: {
    score: number;
    axes: { name: string; value: number; max: number }[];
  };
  trendStrength: {
    aboveMa5Pct: number;
    aboveMa20Pct: number;
    aboveMa60Pct: number;
    high60Count: number;
    low60Count: number;
    highLowRatioPct: number;
  };
  practicalMonitor: {
    brokenCount: number;
    limitDownCount: number;
    aboveMa60Pct: number;
    high60Count: number;
    low60Count: number;
    highTurnoverCount: number;
    volExpansionRatio: number;
  };
  ladderSummary: {
    limitUpCount: number;
    sealRate: number;
    tiers: {
      streak: number;
      count: number;
      stocks: { code: string; name: string }[];
    }[];
  };
  conceptHot: {
    leading: SectorHotItem[];
    lagging: SectorHotItem[];
    sourceNote?: string;
  };
  industryHot: {
    leading: SectorHotItem[];
    lagging: SectorHotItem[];
    sourceNote?: string;
  };
  monitorSummary: {
    enabledRules: number;
    totalRules: number;
    statusText: string;
    recentAlerts: AlertTriggerEvent[];
  };
}

export type LadderPool = 'zt' | 'zb' | 'db';
export type BoardFilter = 'all' | 'main' | 'chinext' | 'star' | 'bse' | 'st';

export interface LadderStockItem {
  code: string;
  name: string;
  board: BoardFilter;
  boardBadge?: string;
  price: number;
  changePct: number;
  streak: number;
  yesterdayStreak?: number;
  firstSealTime?: string;
  lastSealTime?: string;
  openCount?: number;
  sealAmount?: number;
  turnoverRate?: number;
  amount?: number;
  marketCap?: number;
  reason?: string;
  industry: string;
  industryPath?: string;
  concepts: string[];
  statusTag?: string;
}

export interface LadderResponse {
  date: string;
  pool: LadderPool;
  board: BoardFilter;
  limitUpCount: number;
  limitDownCount: number;
  brokenCount: number;
  brokenStreakCount: number;
  sealRate: number;
  auditNote: string;
  updatedAt: string;
  tierCounts: { streak: number; label: string; count: number }[];
  conceptDist: { name: string; count: number }[];
  industryDist: { name: string; count: number }[];
  tiers: { streak: number; label: string; stocks: LadderStockItem[] }[];
  stocks: LadderStockItem[];
}

export interface MarketEnvDay {
  date: string;
  score: number;
  state: EnvState;
  limitUpCount: number;
  profit: number;
  speculation: number;
  resilience: number;
  trend: number;
  shClose?: number;
  shChangePct?: number;
}

export interface MarketEnvResponse {
  range: string;
  updatedAt: string;
  latest: {
    date: string;
    score: number;
    state: EnvState;
    momentumDays: number;
    momentumText: string;
    breakdown: {
      profit: number;
      speculation: number;
      resilience: number;
      trend: number;
    };
  };
  cyclePhase: {
    phase: '冰点期' | '启动期' | '发酵期' | '高潮期' | '退潮期';
    advice: string;
    positionRange: string;
    description: string;
  };
  transitions: {
    windowDays: number;
    count: number;
    rhythm: string;
  };
  stateDistribution: {
    state: EnvState;
    count: number;
    pct: number;
    color: string;
  }[];
  timeline: MarketEnvDay[];
  calendarMonths: {
    month: string;
    label: string;
    avgScore: number;
    days: {
      date: string;
      day: number;
      weekday: number;
      score: number;
      state: EnvState;
    }[];
  }[];
}

export interface ConceptLeaderItem {
  code: string;
  name: string;
  changePct: number;
  dragonScore: number;
  price?: number;
}

export interface ConceptBoardItem {
  code: string;
  name: string;
  rank: number;
  changePct: number;
  upCount: number;
  downCount: number;
  flatCount: number;
  turnoverRate?: number;
  amount?: number;
  score: number;
  leaders: ConceptLeaderItem[];
}

export interface ConceptsResponse {
  updatedAt: string;
  turningStrong: { name: string; time: string; changePct: number }[];
  turningWeak: { name: string; time: string; changePct: number }[];
  switchSeries: { time: string; switchRate: number; indexPct: number }[];
  momentumTable: {
    code: string;
    name: string;
    changePct: number;
    prev1hPct: number;
    rankChange: number;
    score: number;
  }[];
  kpis: {
    strongestMainline: { name: string; changePct: number; leader: string };
    biggestRisk: { name: string; changePct: number };
    upCount: number;
    downCount: number;
    activeRate: number;
    algoNote: string;
  };
  leading: ConceptBoardItem[];
  lagging: ConceptBoardItem[];
}

export interface IndustryBoardItem {
  code: string;
  name: string;
  level: string;
  parentName?: string;
  stockCount: number;
  upCount: number;
  downCount: number;
  flatCount: number;
  changePct: number;
  strength: number;
  amount: number;
  turnoverRate: number;
  leaderCode?: string;
  leaderName?: string;
  leaderChangePct?: number;
}

export interface IndustriesResponse {
  updatedAt: string;
  heatDistribution: {
    code: string;
    name: string;
    stockCount: number;
    changePct: number;
  }[];
  industries: IndustryBoardItem[];
}

export interface IndustryDetailResponse {
  code: string;
  name: string;
  level: string;
  hierarchy: string[];
  stats: {
    upCount: number;
    downCount: number;
    flatCount: number;
    avgChangePct: number;
  };
  klines: KLineBar[];
  constituents: StockQuoteItem[];
}

export interface WatchlistItem {
  code: string;
  name: string;
  groupName?: string;
  addedAt: string;
  costPrice?: number;
  shares?: number;
  targetPrice?: number;
  stopLossPrice?: number;
  note?: string;
  quote?: StockQuoteItem;
}

export interface ScreenerRequest {
  strategyId?: string;
  factorId?: string;
  filters?: {
    minChangePct?: number;
    maxChangePct?: number;
    minTurnover?: number;
    maxTurnover?: number;
    minVolRatio?: number;
    minMarketCap?: number;
    maxMarketCap?: number;
    excludeSt?: boolean;
    excludeBse?: boolean;
  };
}

export interface ScreenerResultItem {
  code: string;
  name: string;
  price: number;
  changePct: number;
  turnoverRate: number;
  volumeRatio: number;
  amount: number;
  marketCap: number;
  industry: string;
  signalScore: number;
  reasons: string[];
}

export interface ScreenerResponse {
  updatedAt: string;
  strategyName: string;
  totalScanned: number;
  matched: ScreenerResultItem[];
  factorEval?: {
    factorId: string;
    factorName: string;
    ic: number;
    rankIc: number;
    ir: number;
    quintiles: { group: string; avgReturnPct: number; winRate: number }[];
  };
}

export interface BacktestRequest {
  code: string;
  strategy: string;
  days: number;
  initialCapital: number;
  commissionRate: number;
  stampDutyRate: number;
  slippageRate: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  pmEventId?: string;
  pmSignalMode?: PmEventSignalMode;
  pmShockThresholdPp?: number;
}

export interface BacktestTrade {
  id: number;
  buyDate: string;
  unlockDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  fee: number;
  pnl: number;
  pnlPct: number;
  reason: string;
}

export interface BacktestResponse {
  code: string;
  name: string;
  strategy: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalCapital: number;
  metrics: {
    totalReturnPct: number;
    annualReturnPct: number;
    benchmarkReturnPct: number;
    maxDrawdownPct: number;
    sharpe: number;
    winRatePct: number;
    profitFactor: number;
    totalTrades: number;
  };
  equityCurve: {
    date: string;
    equity: number;
    returnPct: number;
    benchmarkPct: number;
    drawdownPct: number;
  }[];
  trades: BacktestTrade[];
}

export interface AnomalyItem {
  id: string;
  time: string;
  code: string;
  name: string;
  type: string;
  direction: 'bull' | 'bear';
  price: number;
  changePct: number;
  detail: string;
}

export interface MonitorAnomaliesResponse {
  updatedAt: string;
  anomalies: AnomalyItem[];
}

export interface MonitorRule {
  id: string;
  name: string;
  code: string; // '*' for all or specific code
  metric: 'changePct' | 'priceAbove' | 'priceBelow' | 'volumeRatio' | 'brokenBoard';
  threshold: number;
  enabled: boolean;
  createdAt: string;
}

export interface MonitorRulesResponse {
  rules: MonitorRule[];
  events: AlertTriggerEvent[];
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  hasKey?: boolean;
  maskedKey?: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiChatResponse {
  reply: string;
  model: string;
  usedFallback?: boolean;
  timestamp: string;
}

// ================= PandaAI × Polymarket × 期货跨市策略中枢 =================

export interface PandaFactorItem {
  id: string;
  name: string;
  category: string;
  pool: string;
  sourceFile: string;
  expression: string;
  description: string;
  sharpe: number;
  ic: number;
  rankIc: number;
  ir: number;
  turnover: number;
  fitness: number;
  direction: string;
  tags: string[];
}

export interface PmImpactAsset {
  symbol: string;
  name: string;
  market: string;
  direction: '做多' | '做空' | '中性' | string;
  confidence: number;
  logic: string;
}

export interface PmEventItem {
  id: string;
  title: string;
  category: string;
  yesProb: number;
  change24h: number;
  volumeUsd: number;
  url: string;
  impactAssets: PmImpactAsset[];
}

export interface FuturesQuoteItem {
  symbol: string;
  code: string;
  name: string;
  exchange: string;
  price: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevSettle: number;
  volume: number;
  openInterest: number;
  pmSignal: string;
  linkedEventTitle?: string;
  strategyAdvice?: string;
}

export interface ArbitrageStrategyItem {
  id: string;
  name: string;
  type: string;
  legs: string[];
  triggerCondition: string;
  currentSpread: number;
  zScore: number;
  signal: string;
  winRateEst: number;
  riskRule: string;
  sourceDoc: string;
}

export interface AutonomyLogItem {
  id: string;
  folder: string;
  title: string;
  updatedAt: string;
  summary: string;
  content: string;
}

export interface PandaPmOverviewResponse {
  summary: {
    totalMinedFactors: number;
    activePoolsCount: number;
    futuresContractsCount: number;
    pmEventsCount: number;
    account5091NotesCount: number;
    lastUpdated: string;
  };
  factors: PandaFactorItem[];
  pmEvents: PmEventItem[];
  futuresQuotes: FuturesQuoteItem[];
  arbitrageStrategies: ArbitrageStrategyItem[];
  autonomyLogs: AutonomyLogItem[];
}

export interface PandaFactorScanRequest {
  factorId: string;
  topN?: number;
  universe?: 'ashare' | 'futures';
}

export interface PandaFactorScanResponse {
  factor: PandaFactorItem;
  targets: {
    code: string;
    name: string;
    price: number;
    changePct: number;
    factorValue: number;
    zScore: number;
    signal: string;
    reason: string;
  }[];
  stats: {
    mean: number;
    std: number;
    longTopAvgPct: number;
    shortBottomAvgPct: number;
    spreadPct: number;
  };
}

export interface FuturesKLineBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number;
  changePct: number;
  ma5?: number | null;
  ma10?: number | null;
  ma20?: number | null;
  ma60?: number | null;
}

export interface FuturesKlinesResponse {
  symbol: string;
  name: string;
  klines: FuturesKLineBar[];
}

export type FuturesBacktestStrategyType =
  | 'pm_macro_trend'
  | 'panda_factor_momentum'
  | 'dual_thrust'
  | 'turtle_breakout'
  | 'spread_reversion';

export interface FuturesBacktestRequest {
  symbol: string;
  strategyType: FuturesBacktestStrategyType;
  days?: number;
  initialCapital?: number;
  leverage?: number;
  stopLossPct?: number;
}

export interface FuturesBacktestResponse {
  symbol?: string;
  name?: string;
  metrics: {
    totalReturnPct: number;
    annualReturnPct: number;
    maxDrawdownPct: number;
    sharpe: number;
    winRatePct: number;
    profitFactor: number;
    tradeCount: number;
  };
  equityCurve: {
    date: string;
    equity: number;
    benchmark: number;
    price: number;
  }[];
  klines: FuturesKLineBar[];
  trades: {
    entryDate: string;
    exitDate: string;
    side: '做多' | '做空' | string;
    entryPrice: number;
    exitPrice: number;
    lots: number;
    pnl: number;
    returnPct: number;
    reason: string;
  }[];
}

// ================= V4: Polymarket × 交易标的深度关联挖掘与事件概率联立回测 =================

export type PmAssetUniverse = 'all' | 'futures' | 'ashare_stock' | 'sector';

export type PmEventSignalMode =
  | 'shock_breakout'       // 概率脉冲突破 (|ΔP| >= 阈值 且标的未充分计价)
  | 'divergence_reversion' // 隐含定价偏离回归 (预期差残差 Z-Score 均值回归)
  | 'regime_trend'         // 概率阈值趋势共振 (PM概率状态过滤 + 均线/因子顺势)
  | 'kelly_pair_basket';   // 跨品种多空瓶颈篮子 + Kelly动态仓位

export interface PmLeadLagPoint {
  lag: number;       // -5 .. +5 (lag > 0 表示 PM概率变化 领先 标的收益 lag 个交易日)
  corr: number;      // Pearson Corr(ΔP_t, R_{t+lag})
  rankCorr: number;  // Spearman Rank Corr
  tStat: number;     // 显著性 t 统计量
  sampleSize: number;
}

export interface PmDiscoveredRelationItem {
  eventId: string;
  eventTitle: string;
  eventCategory: string;
  yesProb: number;          // 0..100 (%)
  probChange24h: number;    // 24h百分点变化, e.g. +4.2
  probChange5d: number;     // 5日百分点变化
  assetSymbol: string;      // e.g. 'AU0', 'SC0', 'EC0', '601899', '300308', 'BK1036'
  assetName: string;
  assetMarket: '国内期货' | 'A股瓶颈龙头' | 'A股板块指数' | string;
  transmissionTier: '一阶直连' | '二阶传导' | '宏观共振';
  expectedDirection: 1 | -1; // +1 Yes升利多, -1 Yes升利空
  mechanism: string;        // 产业链/物理瓶颈/宏观传导机理
  hedgeLegSymbol?: string;  // 配对对冲腿代码 (如 AG0, RB0, sh000300)
  hedgeLegName?: string;
  optimalLagDays: number;   // 最优领先天数 (>0 代表 PM 领先标的)
  pearsonCorr: number;
  spearmanCorr: number;
  shockCorr: number;        // 概率异动期(|ΔP|>=阈值)条件相关系数
  shockHitRate: number;     // 概率异动后标的同向胜率 (0..100%)
  grangerFStat: number;     // 领先预测 F 统计强度
  rollingBeta: number;      // 标的收益率(%) 对 PM ΔP(百分点) 回归弹性 Beta
  impliedPrice: number;     // 基于滚动协整模型推算的 PM 隐含公允价
  actualPrice: number;      // 标的当前最新价
  divergenceZScore: number; // 预期差残差 Z = (Actual - Implied)/σ (结合expectedDirection判定滞后度)
  alphaState: '预期差严重滞后' | 'PM异动共振' | '定价充分' | '短期过热背离';
  compositeScore: number;   // 0..100 综合关联度评分
  kellySuggestedPct: number;// 建议半Kelly仓位比例 (0..100%)
  leadLagProfile: PmLeadLagPoint[];
}

export interface PmDiscoverRelationsRequest {
  eventId?: string;
  customQuery?: string;
  universe?: PmAssetUniverse;
  lookbackDays?: number;
  shockThresholdPp?: number;
  topN?: number;
}

export interface PmRelationMatrixResponse {
  updatedAt: string;
  alignmentRule: string;
  events: PmEventItem[];
  relations: PmDiscoveredRelationItem[];
  matrixCells: {
    eventId: string;
    eventShortTitle: string;
    assetSymbol: string;
    assetName: string;
    optimalLagDays: number;
    shockCorr: number;
    divergenceZScore: number;
    compositeScore: number;
  }[];
  methodologyNotes: string[];
}

export interface PmEventBacktestRequest {
  eventId: string;
  assetSymbol: string;
  hedgeSymbol?: string;
  signalMode: PmEventSignalMode;
  days?: number;
  shockThresholdPp?: number;
  divergenceZEntry?: number;
  probRegimeThreshold?: number;
  holdingHorizonDays?: number;
  lagExecutionDays?: number;
  initialCapital?: number;
  leverage?: number;
  stopLossPct?: number;
  useKellySizing?: boolean;
}

export interface PmEventAlignedPoint {
  date: string;
  yesProb: number;
  probDelta: number;
  assetClose: number;
  assetReturnPct: number;
  impliedAssetPrice: number;
  divergenceZ: number;
  rollingCorr20d: number;
  positionDir: -1 | 0 | 1;
}

export interface PmEventBacktestTrade {
  id: number;
  entryDate: string;
  exitDate: string;
  side: '做多' | '做空' | '多空配对';
  entryPrice: number;
  exitPrice: number;
  entryProb: number;
  exitProb: number;
  entryProbDelta: number;
  entryDivergenceZ: number;
  positionPct: number;
  pnl: number;
  returnPct: number;
  holdingDays: number;
  reason: string;
}

export interface PmEventBacktestResponse {
  eventId: string;
  eventTitle: string;
  assetSymbol: string;
  assetName: string;
  assetMarket: string;
  executionRule: string;
  signalMode: PmEventSignalMode;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalCapital: number;
  relationSummary: {
    optimalLagDays: number;
    pearsonCorr: number;
    shockCorr: number;
    shockHitRate: number;
    currentDivergenceZ: number;
    rollingBeta: number;
    kellySuggestedPct: number;
    mechanism: string;
  };
  leadLagProfile: PmLeadLagPoint[];
  alignedSeries: PmEventAlignedPoint[];
  equityCurve: {
    date: string;
    equity: number;
    returnPct: number;
    benchmarkPct: number;
    drawdownPct: number;
  }[];
  metrics: {
    totalReturnPct: number;
    annualReturnPct: number;
    benchmarkReturnPct: number;
    excessReturnPct: number;
    maxDrawdownPct: number;
    sharpe: number;
    calmar: number;
    informationRatio: number;
    winRatePct: number;
    profitFactor: number;
    avgHoldingDays: number;
    kellyOptimalPct: number;
    tradeCount: number;
  };
  trades: PmEventBacktestTrade[];
}

// ================= V5 全维超前认知定价中枢 & CPO五节点贝叶斯传导系统 =================

export interface UsOpticsAnchorItem {
  symbol: string;       // 'COHR' | 'LITE' | 'AVGO' | 'FN' | 'NVDA' | 'MRVL'
  name: string;
  role: string;         // e.g. '光模块原厂1:1映射' | 'DSP/定制ASIC锚' | 'GPU总锚'
  price: number;
  changePct: number;
  volumeRatio: number;
  weight: number;
  signal: '强共振利多' | '温和偏多' | '中性' | '背离承压';
}

export interface CpoCoreAnchorItem {
  code: string;         // '300308' | '300502' | '300394'
  name: string;
  price: number;
  vwap: number;
  vwapSpreadPct: number;// (price - vwap)/vwap * 100
  changePct: number;
  turnoverRate: number;
  volumeRatio: number;
  amount: number;
  vwapConfirmed: boolean;
}

export interface CpoSecondOrderTarget {
  code: string;
  name: string;
  subSector: string;    // '液冷散热' | 'AI高端PCB' | '国产算力ASIC' | 'MPO/铜连接' | 'AI电源' | '光芯片'
  price: number;
  changePct: number;
  volumeRatio: number;
  amount: number;
  rollingBetaToCpo: number;
  impliedChangePct: number;
  residualZScore: number;   // 负值代表滞后于CPO锚点 (Z < -1.25 为高胜率二阶补涨窗口)
  optimalLagDays: number;
  hitRatePct: number;
  catchupSignal: '强补涨滞后' | '同步共振' | '短期透支' | '门控拦截';
}

export interface CpoDagNodeState {
  nodeId: 'node0_overseas' | 'node1_cpo_anchor' | 'node2_tech_diffusion' | 'node3_chinext_dual' | 'node4_futures_exec';
  title: string;
  subtitle: string;
  score: number;        // -100 .. +100
  status: '强力传导' | '温和顺畅' | '中性钝化' | '断链阻断' | '空头反噬';
  keyMetricText: string;
  leadLagText: string;
}

export interface CpoGateStatus {
  id: string;
  name: string;
  passed: boolean;
  currentValueText: string;
  thresholdText: string;
  vetoReason?: string;
}

export interface CpoTrapAlert {
  id: 'siphon_trap' | 'crowding_exhaustion' | 'cross_market_decouple';
  name: string;
  triggered: boolean;
  severity: 'normal' | 'warn' | 'critical';
  detail: string;
  counterMeasure: string;
}

export interface CpoPlaybookItem {
  legType: '一阶CPO核心锚' | '二阶硬件滞后补涨' | '创业板ETF(159915)' | '股指期货(IC0/IM0)';
  symbol: string;
  name: string;
  action: '做多出击' | '配对多空对冲' | '观望等待门控' | '减仓/空单保护';
  suggestedWeightPct: number;
  entryRule: string;
  falsificationStop: string;
  rationale: string;
}

export interface CpoTransmissionOverviewResponse {
  updatedAt: string;
  alignmentNote: string;
  regime: '放量主升扩散态' | '缩量存量虹吸态' | '高拥挤利好兑现预警' | '内外盘背离观望态' | '空头破位传导态';
  bayesianPosteriorProb: number; // 0..100 (%)
  kellyPositionPct: number;      // 0..100 (%)
  marketContext: {
    allAVolumeRatio: number;
    tmtTurnoverSharePct: number;
    cpoBasketChangePct: number;
    vwapConfirmCount: number;
    catlChangePct: number;       // 300750 宁德时代
    chinextChangePct: number;    // 399006 创业板指
    chinextOptionPcr: number;
    chinextOptionSkew: number;
    ic0ChangePct: number;
    im0ChangePct: number;
  };
  nodes: CpoDagNodeState[];
  gates: CpoGateStatus[];
  traps: CpoTrapAlert[];
  usAnchors: UsOpticsAnchorItem[];
  cpoAnchors: CpoCoreAnchorItem[];
  secondOrderTargets: CpoSecondOrderTarget[];
  playbooks: CpoPlaybookItem[];
}

export interface CpoTransmissionBacktestRequest {
  targetSymbol: string;  // '159915' | 'IC0' | 'IM0' | 'PAIR_CPO_IM0' | '002837' | '002463' | '688256' | '300308'
  days?: number;         // default 120
  crowdingCapPct?: number; // default 38
  requireVwapGate?: boolean; // default true
  requireUsPrior?: boolean;  // default true
  requireDualCore?: boolean; // default true
  useKellySizing?: boolean;  // default true
  initialCapital?: number;   // default 500000
  stopLossPct?: number;      // default 5
}

export interface CpoTransmissionBacktestResponse {
  targetSymbol: string;
  targetName: string;
  executionRule: string;
  startDate: string;
  endDate: string;
  gatedMetrics: {
    totalReturnPct: number;
    annualReturnPct: number;
    sharpe: number;
    informationRatio: number;
    maxDrawdownPct: number;
    winRatePct: number;
    profitFactor: number;
    kellySuggestedPct: number;
    tradeCount: number;
  };
  naiveMetrics: {
    totalReturnPct: number;
    annualReturnPct: number;
    sharpe: number;
    maxDrawdownPct: number;
    winRatePct: number;
    tradeCount: number;
  };
  benchmarkReturnPct: number;
  gateAttribution: {
    gateName: string;
    blockedTrades: number;
    avoidedLossPct: number;
  }[];
  equityCurve: {
    date: string;
    gatedReturnPct: number;
    naiveReturnPct: number;
    benchmarkPct: number;
    gatedDrawdownPct: number;
    tmtCrowdingPct: number;
    posteriorProb: number;
  }[];
  trades: {
    id: number;
    entryDate: string;
    exitDate: string;
    side: '做多' | '做空' | '多CPO/空IM0';
    entryPrice: number;
    exitPrice: number;
    posteriorProb: number;
    cpoAnchorPct: number;
    usOpticsPct: number;
    tmtCrowdingPct: number;
    positionPct: number;
    pnl: number;
    returnPct: number;
    reason: string;
  }[];
}

export type AltConsensusSourceType =
  | 'kalshi_pm_spread'
  | 'manifold_tech_velocity'
  | 'hyperliquid_shadow_gap'
  | 'funding_rate_squeeze'
  | 'option_skew_pcr'
  | 'futures_back_contango';

export interface CrossVenuePredictionItem {
  id: string;
  theme: string;
  category: '联储宏观' | 'AI与算力' | '关税地缘' | '能源航运' | '极端气候' | string;
  title: string;
  kalshiTicker?: string;
  kalshiProb: number | null;     // 0..100
  pmProb: number | null;         // 0..100
  manifoldProb: number | null;   // 0..100
  consensusProb: number;         // 加权共识概率
  delta24hPp: number;
  maxVenueSpreadPp: number;      // 跨平台最大定价差
  leadVenue: 'Kalshi机构盘' | 'Polymarket资金盘' | 'Manifold极客盘';
  divergenceSignal: '机构盘抢跑看多' | '极客盘超前异动' | '三盘高强度共振' | '跨所分歧待收敛';
  mappedAssets: { symbol: string; name: string; direction: '做多' | '做空' }[];
  dataMode: 'live_api' | 'hybrid_calibrated';
}

export interface ShadowPerpItem {
  coin: string;                  // 'PAXG' | 'BTC' | 'ETH' | 'SOL' | 'HYPE'
  label: string;
  mappedCnAsset: string;         // e.g. 'AU0 沪金 / 600547'
  markPrice: number;
  change24hPct: number;
  overnightShadowGapPct: number; // 15:00 CST -> 09:00 CST 休市窗口涨跌幅
  annualizedFundingPct: number;
  fundingZScore: number;
  openInterestUsd: number;
  regimeSignal: '周末/隔夜抢跑利多' | '空头挤仓预警' | '多头拥挤过热' | '平稳中性';
}

export interface OptionSkewSentimentItem {
  symbol: string;                // '159915.OPT' | '510300.OPT' | '510050.OPT' | 'DERIBIT.BTC' | 'USDCNH'
  name: string;
  underlyingCode: string;
  underlyingPrice: number;
  underlyingChangePct: number;
  atmIvPct: number;
  ivSkew25d: number;             // Call IV - Put IV (正值看涨偏度, 负值看跌尾部保护)
  pcrVolume: number;             // 认沽/认购成交比
  smartMoneySignal: '机构抢购虚值看涨' | '尾部认沽保护升温' | '期权正股背离预警' | '中性均衡';
  leadTarget: string;
}

export interface FuturesTermStructureItem {
  variety: string;               // 'LC' | 'EC' | 'SC' | 'AU' | 'CU' | 'AG' | 'RB' | 'I' | 'MA' | 'TA' | 'SI' | 'M'
  name: string;
  nearContract: string;
  farContract: string;
  nearPrice: number;
  farPrice: number;
  spread: number;                // near - far
  annualizedRollYieldPct: number;// 正值=Back现货升水逼仓, 负值=Contango远月升水累库
  spreadChange5dPct: number;
  spreadZScore20d: number;
  structureRegime: '强Back现货逼仓' | '温和Back去库' | 'Contango累库贴水' | '深Contango过剩';
  mappedStockCode: string;
  mappedStockName: string;
  leadLagDays: number;
}

export interface IngestionFeedStatus {
  id: string;
  name: string;
  moduleName: string;
  method: '免Key公开REST JSON' | '交易所实时接口' | 'SSR内嵌JSON提取' | 'Ego静默浏览器守护';
  endpointHint: string;
  ok: boolean;
  latencyMs: number;
  itemCount: number;
  lastCapturedAt: string;
  detail: string;
}

export interface ConsensusCollectorConfig {
  metaculusToken?: string;
  githubToken?: string;
  autoSnapshotMinutes: number;
  egoCollectorEnabled: boolean;
  hasMetaculusToken?: boolean;
  hasGithubToken?: boolean;
}

export interface ConsensusSnapshotRecord {
  timestamp: string;
  kalshiCount: number;
  manifoldCount: number;
  pmCount: number;
  paxgPrice: number;
  btcFundingAnnualPct: number;
  chinextPcr: number;
  topBackVariety: string;
  topBackRollYieldPct: number;
}

export interface AltConsensusOverviewResponse {
  updatedAt: string;
  alignmentRule: string;
  crossVenuePredictions: CrossVenuePredictionItem[];
  shadowPerps: ShadowPerpItem[];
  optionSkews: OptionSkewSentimentItem[];
  termStructures: FuturesTermStructureItem[];
  feeds: IngestionFeedStatus[];
  snapshots: ConsensusSnapshotRecord[];
  collectorConfig: ConsensusCollectorConfig;
  egoScriptPath: string;
}

export interface AltConsensusBacktestRequest {
  sourceType: AltConsensusSourceType;
  signalId?: string;             // specific event id, coin, or variety
  assetSymbol: string;           // 'AU0' | 'SC0' | 'EC0' | 'LC0' | 'IC0' | '159915' | '300308' | '601899' | '601919' | '300750'
  days?: number;                 // default 120
  entryZThreshold?: number;      // default 1.25
  holdingDays?: number;          // default 5
  leverage?: number;             // A-share locked 1.0, Futures 1..10
  useKellySizing?: boolean;
  stopLossPct?: number;
  initialCapital?: number;
}

export interface AltConsensusBacktestResponse {
  sourceType: AltConsensusSourceType;
  sourceLabel: string;
  assetSymbol: string;
  assetName: string;
  executionRule: string;
  startDate: string;
  endDate: string;
  optimalLagDays: number;
  shockCorr: number;
  shockHitRate: number;
  currentSignalZ: number;
  kellySuggestedPct: number;
  leadLagProfile: PmLeadLagPoint[];
  alignedSeries: {
    date: string;
    consensusValue: number;
    consensusZ: number;
    assetClose: number;
    assetReturnPct: number;
  }[];
  equityCurve: {
    date: string;
    returnPct: number;
    benchmarkPct: number;
    drawdownPct: number;
  }[];
  metrics: {
    totalReturnPct: number;
    annualReturnPct: number;
    excessReturnPct: number;
    sharpe: number;
    informationRatio: number;
    maxDrawdownPct: number;
    winRatePct: number;
    profitFactor: number;
    tradeCount: number;
  };
  trades: {
    id: number;
    entryDate: string;
    exitDate: string;
    side: '做多' | '做空';
    entryPrice: number;
    exitPrice: number;
    signalValue: number;
    signalZ: number;
    positionPct: number;
    pnl: number;
    returnPct: number;
    reason: string;
  }[];
}

// ================= V6–V8 (v1.2.0-enterprise) 多租户量化SaaS · SQLite · 实时流 · 机构OMS实盘交易柜台 =================

export interface OmsOrderBookLevel {
  level: number; // 1..5
  price: number;
  volume: number; // 手数 (A股100股/手, 期货1合约/手)
}

export interface OmsQuotePreviewResponse {
  symbol: string;
  name: string;
  market: 'ashare' | 'futures';
  lastPrice: number;
  prevClose: number;
  changePct: number;
  upperLimit: number;
  lowerLimit: number;
  lotSize: number;
  multiplier: number;
  tickSize: number;
  estSlippageBps: number;
  commissionRate: number;
  stampDutyRate: number;
  transferFeeRate: number;
  bids: OmsOrderBookLevel[];
  asks: OmsOrderBookLevel[];
  updatedAt: string;
}

export interface OmsExecutionPolicy {
  userId: string;
  autoFollow4of4: boolean;
  autoStopLossGuard: boolean;
  autoAllocPct: number;
  maxDailyAutoOrders: number;
  defaultSlippageBps: number;
  updatedAt: string;
}

export type SaasPlanTier = 'free' | 'pro' | 'institutional';
export type SaasSeatRole = 'admin' | 'pm' | 'researcher';

export interface SaasUserProfile {
  id: string;
  username: string;
  displayName: string;
  planTier: SaasPlanTier;
  seatRole: SaasSeatRole;
  createdAt: string;
}

export interface SaasAuthResponse {
  token: string;
  user: SaasUserProfile;
  availableDemoSeats: SaasUserProfile[];
}

export interface SaasApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  rawKeyOnce?: string; // 仅在创建时返回一次完整 tsp_live_...
  scopes: string[];
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface SqliteTableStat {
  tableName: string;
  rowCount: number;
  description: string;
}

export interface StreamJobStat {
  name: string;
  intervalSec: number;
  lastRunAt: string | null;
  runCount: number;
  status: 'idle' | 'running' | 'ok' | 'error';
  lastDetail?: string;
}

export interface SaasSystemDiagnostics {
  version: string;
  dbPath: string;
  journalMode: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  tables: SqliteTableStat[];
  stream: {
    connectedClients: number;
    totalFramesPushed: number;
    uptimeSec: number;
    sessionMode?: 'PRE_OPEN' | 'LIVE_TRADING' | 'OFF_HOURS';
    sessionLabel?: string;
    jobs: StreamJobStat[];
  };
  desktopClient: {
    exePath: string;
    exeExists: boolean;
    launchCommand: string;
  };
  currentUser: SaasUserProfile;
  availableSeats: SaasUserProfile[];
  apiKeys: SaasApiKeyItem[];
}

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
  availableQuantity: number; // A股当日买入为0(T+1锁仓), 次日解锁; 期货等于quantity(T+0)
  avgCost: number;
  lastPrice: number;
  leverage: number;
  marginOccupied: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  strategyTag: string;
  openedDate: string;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  distanceToStopPct?: number | null;
}

export interface PaperOrderItem {
  id: number;
  execId?: string;
  orderType?: 'MARKET_IOC' | 'LIMIT' | 'AUTO_SIGNAL' | 'AUTO_GUARD';
  slippageBps?: number;
  taxAndFeeDetail?: string;
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
  orderType?: 'MARKET_IOC' | 'LIMIT' | 'AUTO_SIGNAL' | 'AUTO_GUARD';
  quantity?: number;
  capitalAllocationPct?: number; // 若未传quantity，可按组合净值比例自动算整手/手数
  price?: number;                // 未传则按五档盘口最优价含滑点撮合
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  slippageBps?: number;
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
  policy?: OmsExecutionPolicy;
  navHistory: {
    timestamp: string;
    totalEquity: number;
    returnPct: number;
    cashBalance: number;
  }[];
}

export interface ArchivedBacktestItem {
  id: string;
  userId: string;
  engineType:
    | 'ashare_t1'
    | 'pm_event'
    | 'cpo_dag'
    | 'alt_consensus'
    | 'futures_t0'
    | 'fact_buypoint'
    | 'fupeng_barbell'
    | string;
  symbol: string;
  symbolName: string;
  strategyName: string;
  totalReturnPct: number;
  excessReturnPct: number;
  annualReturnPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  winRatePct: number;
  tradeCount: number;
  paramsSummary: string;
  createdAt: string;
}

export type WebhookProviderType = 'feishu' | 'dingtalk' | 'wecom' | 'telegram' | 'custom_json';

export interface WebhookChannelItem {
  id: string;
  name: string;
  provider: WebhookProviderType;
  webhookUrl: string;
  secret?: string;
  enabled: boolean;
  eventsFilter: string[]; // ['anomaly', 'cpo_gate', 'pm_shock', 'paper_fill']
  lastStatus?: string | null;
  lastSentAt?: string | null;
  createdAt: string;
}

export interface RealtimePulsePayload {
  timestamp: string;
  connectedClients: number;
  indices: IndexQuote[];
  breadth?: {
    up: number;
    flat: number;
    down: number;
    limitUp: number;
    limitDown: number;
  };
  paperSummary?: {
    portfolioName: string;
    totalEquity: number;
    totalReturnPct: number;
    unrealizedPnl: number;
  };
}


// ================= V7 多标的专属事实因子历史大复盘 & 付鹏24h宏观FICC交易框架 =================

export type FactArchetypeCategory =
  | 'all'
  | 'precious_rates'    // 贵金属去美元化与联储利率事实链
  | 'energy_shipping'   // 地缘咽喉航运与能化事实链
  | 'ai_optics'         // 全球AI算力与光通信硬件事实链
  | 'grid_storage'      // 北美缺电电网出海与储能事实链
  | 'dividend_bond';    // 低利率红利垄断与长债事实链

export interface FactBuyPointCondition {
  id: string;
  label: string;        // e.g. '1.专属PM/事实因子脉冲' | '2.隐含估值滞后Z<=-1.15' | '3.微观VWAP/Back期限确认' | '4.拥挤度与证伪排雷'
  passed: boolean;
  currentText: string;
  ruleText: string;
}

export interface HistoricalFactEpisode {
  episodeId: string;
  symbol: string;
  triggerDate: string;
  pmEventTitle: string;
  pmResolvedStatus: '已兑现(YES)' | '已证伪(NO)' | '进行中(LIVE)';
  factShockSummary: string;     // e.g. 'PM霍尔木兹风险+6.8pp · 近月Back升水+48%'
  entryPrice: number;
  valuationLagZ: number;        // 触发时标的滞后Z-Score
  microConfirmPassed: boolean;  // VWAP或Back期限结构是否确认
  crowdingSafePassed: boolean;
  isDeterministicSetup: boolean;// true = 四维共振确定性买点; false = 粗糙单因子噪音触发
  side: '做多' | '做空';
  retT1Pct: number;
  retT3Pct: number;
  retT5Pct: number;
  retT10Pct: number;
  mfePct: number;               // 最大有利偏离 (最大浮盈%)
  maePct: number;               // 最大不利偏离 (盘中最大回撤%)
  hitSuccess: boolean;
  postMortemNote: string;       // 复盘定性结论 (为何大赚或为何单因子失效)
}

export interface AssetFactBuyPointProfile {
  symbol: string;
  name: string;
  market: '国内期货' | 'A股核心龙头';
  archetype: Exclude<FactArchetypeCategory, 'all'>;
  archetypeLabel: string;
  factRecipeTitle: string;      // 专属事实因子组合名称
  factFactors: string[];        // 参与定价的3个核心事实因子名称
  executionRule: string;        // 'A股 T+1 整手仅做多' | '国内期货 T+0 双向杠杆'
  lastPrice: number;
  changePct: number;
  // 大样本历史复盘对比统计
  totalHistoricalEpisodes: number;
  rawTriggerCount: number;
  rawWinRatePct: number;
  rawAvgRetT5Pct: number;
  deterministicCount: number;
  deterministicWinRatePct: number; // 四维共振确定性买点历史胜率
  deterministicAvgRetT5Pct: number;
  deterministicAvgRetT10Pct: number;
  optimalStopLossMaePct: number;
  profitFactor: number;
  // 当前实时买点就绪度
  passedConditionsCount: number;   // 0..4
  buyPointState: '确定性买点已触发(4/4)' | '右侧临近待确认(3/4)' | '观察酝酿(2/4)' | '条件未就绪';
  recommendedSide: '做多' | '做空' | '观望';
  suggestedEntryPrice: number;
  falsificationStopPrice: number;
  targetPayoffRangeText: string;
  kellySuggestedPct: number;
  checklist: FactBuyPointCondition[];
}

export interface FactBuyPointOverviewResponse {
  updatedAt: string;
  totalEpisodesAudited: number;
  avgRawWinRatePct: number;
  avgDeterministicWinRatePct: number;
  triggeredCount4of4: number;
  nearCount3of4: number;
  profiles: AssetFactBuyPointProfile[];
}

export interface AssetFactDetailResponse {
  profile: AssetFactBuyPointProfile;
  priceSeries: {
    date: string;
    close: number;
    factCompositeIndex: number;
    valuationLagZ: number;
    marker?: 'deterministic_buy' | 'raw_noise' | null;
  }[];
  episodes: HistoricalFactEpisode[];
  comparisonCurve: {
    date: string;
    deterministicReturnPct: number;
    rawFactorReturnPct: number;
    benchmarkPct: number;
    drawdownPct: number;
  }[];
}

export interface FactBuyPointBacktestRequest {
  symbol: string;
  days?: number;
  maxLagZ?: number;              // default -1.15
  requireMicroConfirm?: boolean; // default true
  requireCrowdingSafe?: boolean; // default true
  holdingDays?: number;          // default 5
  stopLossPct?: number;          // default 4
}

export interface FactBuyPointBacktestResponse {
  symbol: string;
  name: string;
  executionRule: string;
  deterministicMetrics: {
    tradeCount: number;
    winRatePct: number;
    totalReturnPct: number;
    annualReturnPct: number;
    sharpe: number;
    maxDrawdownPct: number;
    avgTradePct: number;
    profitFactor: number;
  };
  rawMetrics: {
    tradeCount: number;
    winRatePct: number;
    totalReturnPct: number;
    sharpe: number;
    maxDrawdownPct: number;
  };
  comparisonCurve: {
    date: string;
    deterministicReturnPct: number;
    rawFactorReturnPct: number;
    benchmarkPct: number;
    drawdownPct: number;
  }[];
  episodes: HistoricalFactEpisode[];
}

// ================= 付鹏老师 24h 实时情报流 & 全球宏观 FICC 交易框架 =================

export type FupengMacroPillar =
  | '哑铃左端·长债红利防御'
  | '哑铃右端·AI生产力与出海硬瓶颈'
  | '逆全球化·黄金硬通货重估'
  | 'FICC套息拆仓与波动率冲击'
  | '大宗商品·Back现实缺口vs过剩内卷'
  | '居民资产负债表与地产周期';

export interface FupengFiccCoordinate {
  id: string;
  name: string;                 // e.g. '铜金比 (CU0/AU0)' | '油金比 (SC0/AU0)' | '国内长债锚 (TL0 & 红利利差)' | '套息与高拥挤拆仓雷达'
  currentValueText: string;
  change20dText: string;
  regimeReading: string;        // 付鹏框架定性解读
  signalBias: '利多防御/黄金' | '利多AI硬瓶颈' | '利多Back资源' | '高拥挤去杠杆预警' | '中性均衡';
}

export interface FupengReferenceTarget {
  symbol: string;
  name: string;
  market: '国内期货' | 'A股核心标的' | '核心ETF';
  price: number;
  changePct: number;
  change20dPct: number;
  frameworkRole: string;        // 在付鹏框架中的精确定位
  direction: '做多底仓' | '门控右侧做多' | '空头对冲/规避' | '多空配对腿';
  suggestedWeightPct: number;
  entryTriggerRule: string;     // 定量参与条件
  falsificationRule: string;    // 付鹏式逻辑证伪离场条件
}

export interface FupengTradableBasket {
  id: string;
  name: string;
  pillar: FupengMacroPillar;
  thesisSummary: string;
  currentRegimeFit: '强烈契合·主配' | '标准底仓配置' | '高拥挤收缩防守' | '空头对冲激活';
  recommendedAllocationPct: number;
  targets: FupengReferenceTarget[];
}

export interface FupengIntelItem {
  id: string;
  publishedAt: string;
  capturedAt: string;
  sourceChannel: 'Bing资讯RSS' | '东财财富号/资讯' | '新浪财经/微博' | '财联社/见闻' | '本地宏观智库' | 'Ego24h静默守护' | '手工纪要投喂' | string;
  title: string;
  summary: string;
  url: string;
  pillar: FupengMacroPillar;
  stance: '看多配置' | '超配防御' | '警惕拥挤去杠杆' | '对冲回避';
  confidenceScore: number;
  mappedTargets: {
    symbol: string;
    name: string;
    direction: '做多' | '做空' | '门控观察';
  }[];
}

export interface FupengScraperChannelStatus {
  id: string;
  name: string;
  method: string;
  ok: boolean;
  latencyMs: number;
  fetchedCount: number;
  lastCheckedAt: string;
  detail: string;
}

export interface FupengOverviewResponse {
  updatedAt: string;
  macroRegimeHeadline: string;
  macroRegimeSummary: string;
  watcherDaemonStatus: {
    enabled: boolean;
    intervalSec: number;
    lastScrapedAt: string;
    totalStoredIntelCount: number;
    egoWatcherScriptPath: string;
  };
  coordinates: FupengFiccCoordinate[];
  baskets: FupengTradableBasket[];
  intelFeed: FupengIntelItem[];
  scraperChannels: FupengScraperChannelStatus[];
}

export interface FupengBarbellBacktestRequest {
  days?: number;                // default 180
  dividendLeftWeightPct?: number; // default 40 (长江电力/神华/红利/长债代理)
  aiRightMaxWeightPct?: number;   // default 30 (中际旭创/思源电气/阳光电源, 受拥挤度动态门控)
  goldHardWeightPct?: number;     // default 30 (沪金AU0/山东黄金/紫金矿业)
  enableDeleverageGate?: boolean; // default true (TMT>38%或Skew恶化时自动把右端切向黄金/现金)
}

export interface FupengBarbellBacktestResponse {
  startDate: string;
  endDate: string;
  barbellMetrics: {
    totalReturnPct: number;
    annualReturnPct: number;
    sharpe: number;
    calmar: number;
    maxDrawdownPct: number;
    winRateMonthsPct: number;
    excessVsHs300Pct: number;
  };
  staticEqualMetrics: {
    totalReturnPct: number;
    sharpe: number;
    maxDrawdownPct: number;
  };
  hs300BenchmarkPct: number;
  deleverageEventsCount: number;
  equityCurve: {
    date: string;
    barbellReturnPct: number;
    staticEqualReturnPct: number;
    hs300ReturnPct: number;
    drawdownPct: number;
    aiEffectiveWeightPct: number;
  }[];
  rebalanceLogs: {
    date: string;
    action: string;
    reason: string;
    weightsText: string;
  }[];
}

export interface GlobalCommandStripSummary {
  updatedAt: string;
  fupengRegime: string;
  fupengIntelCount: number;
  fupengLastScrapedAt: string | null;
  cpoRegime: string;
  cpoGatesPassed: number;
  cpoGatesTotal: number;
  tmtCrowdingPct: number | null;
  fact4of4Symbols: { symbol: string; name: string }[];
  fact3of4Symbols: { symbol: string; name: string }[];
  activeJobsOk: number;
  totalJobs: number;
  sessionMode?: 'PRE_OPEN' | 'LIVE_TRADING' | 'OFF_HOURS';
  sessionLabel?: string;
}

export interface StreamJobTickPayload {
  job: string;
  timestamp: string;
  runCount: number;
  status: 'idle' | 'running' | 'ok' | 'error';
  detail: string;
  commandStrip?: GlobalCommandStripSummary;
}
