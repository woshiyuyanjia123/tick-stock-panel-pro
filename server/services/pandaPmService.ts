import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ArbitrageStrategyItem,
  AutonomyLogItem,
  FuturesBacktestRequest,
  FuturesBacktestResponse,
  FuturesKLineBar,
  FuturesQuoteItem,
  PandaFactorItem,
  PandaFactorScanRequest,
  PandaFactorScanResponse,
  PandaPmOverviewResponse,
  PmEventItem,
  StockQuoteItem,
} from '../../src/types/market';
import { fetchAllAShareSnapshots } from '../providers/eastmoney';
import {
  cachedFetch,
  fetchGbkTextWithRetry,
  fetchJsonWithRetry,
} from '../utils/httpCache';

// Optional READ-ONLY paths to local research vaults (NEVER write/modify)
const FACTOR_LAB_DIR =
  process.env.TSP_FACTOR_LAB_DIR || path.join(os.homedir(), 'factor_mining_lab');
const PANDA_POLY_DIR =
  process.env.TSP_PANDA_POLY_DIR || path.join(os.homedir(), 'panda_poly_quant');
const MOC_DIR =
  process.env.TSP_MOC_DIR ||
  path.join(
    os.homedir(),
    'Desktop',
    '金融',
    '耶鲁与全球宏观因子_期货美股实战智库',
    '14-PandaAIxPolymarket_24h自治实盘与复盘中枢'
  );
const QUANT02_DIR =
  process.env.TSP_QUANT02_DIR ||
  path.join(
    os.homedir(),
    'Desktop',
    '专放文件夹',
    '03_金融量化与商业投研项目',
    '02_量化因子挖掘_小金AI选股策略与28游资心法',
    'quant_research'
  );

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn',
};

interface FuturesMeta {
  symbol: string;
  code: string;
  name: string;
  exchange: 'SHFE' | 'DCE' | 'CZCE' | 'INE' | 'CFFEX' | 'GFEX';
  isCffex?: boolean;
  multiplier: number;
  pmSignal: string;
  linkedEventTitle: string;
  strategyAdvice: string;
}

export const FUTURES_28: FuturesMeta[] = [
  { symbol: 'AU0', code: 'AU0.SHF', name: '沪金主力', exchange: 'SHFE', multiplier: 1000, pmSignal: '偏多', linkedEventTitle: 'FED_HIKE_DEC (88.5%)', strategyAdvice: '做多AU对冲空AG，剥离美元实际利率Beta' },
  { symbol: 'AG0', code: 'AG0.SHF', name: '沪银主力', exchange: 'SHFE', multiplier: 15, pmSignal: '强空', linkedEventTitle: 'FED_HIKE_DEC (88.5%)', strategyAdvice: '联储鹰派定价压制工业白银，空AG配对多AU' },
  { symbol: 'CU0', code: 'CU0.SHF', name: '沪铜主力', exchange: 'SHFE', multiplier: 5, pmSignal: '偏空', linkedEventTitle: 'IN/TX_DC_MORATORIUM (18.5%)', strategyAdvice: '北美算力中心限电延缓电网用铜需求' },
  { symbol: 'AL0', code: 'AL0.SHF', name: '沪铝主力', exchange: 'SHFE', multiplier: 5, pmSignal: '偏多', linkedEventTitle: 'CLIMATE_HOTTEST_2026 (94.0%)', strategyAdvice: '拉尼娜枯水期西南电解铝电力成本支撑' },
  { symbol: 'SC0', code: 'SC0.INE', name: '上海原油', exchange: 'INE', multiplier: 1000, pmSignal: '偏多', linkedEventTitle: 'HORMUZ_NORMAL (5.5%)', strategyAdvice: '霍尔木兹低通航概率提供地缘溢价支撑' },
  { symbol: 'FU0', code: 'FU0.SHF', name: '燃料油主力', exchange: 'SHFE', multiplier: 10, pmSignal: '强多', linkedEventTitle: 'HORMUZ_NORMAL (5.5%)', strategyAdvice: '中东断供链高胜率顺势多头，紧盯美伊停火节点' },
  { symbol: 'EC0', code: 'EC0.INE', name: '欧线集运', exchange: 'INE', multiplier: 50, pmSignal: '偏多', linkedEventTitle: 'IRAN_BLOCKADE_END (22.2%)', strategyAdvice: '航运绕行溢价，关注停火预期突变回撤风控' },
  { symbol: 'LC0', code: 'LC0.GFE', name: '碳酸锂主力', exchange: 'GFEX', multiplier: 1, pmSignal: '强多', linkedEventTitle: 'CLIMATE_HOTTEST_2026 (94.0%)', strategyAdvice: '加州配储强制政策+席位净多共振，偏多配置' },
  { symbol: 'SI0', code: 'SI0.GFE', name: '工业硅主力', exchange: 'GFEX', multiplier: 5, pmSignal: '强多', linkedEventTitle: 'CLIMATE_HOTTEST_2026 (94.0%)', strategyAdvice: '枯水电价抬升+现货升水保护，5091核心多腿' },
  { symbol: 'RB0', code: 'RB0.SHF', name: '螺纹钢主力', exchange: 'SHFE', multiplier: 10, pmSignal: '中性', linkedEventTitle: 'CHINA_GDP_2026 (96.0%)', strategyAdvice: '国内基建托底偏强，可作多螺空卷内需对冲腿' },
  { symbol: 'HC0', code: 'HC0.SHF', name: '热轧卷板', exchange: 'SHFE', multiplier: 10, pmSignal: '偏空', linkedEventTitle: 'LUTNICK_OUT_DEC31 (47.0%)', strategyAdvice: '美关税预期压制出口板材链，逢高偏空配置' },
  { symbol: 'I0', code: 'I0.DCE', name: '铁矿石主力', exchange: 'DCE', multiplier: 100, pmSignal: '强空', linkedEventTitle: 'LUTNICK_OUT_DEC31 (47.0%)', strategyAdvice: '全球制造业走弱+机构净空比共振，空头主力' },
  { symbol: 'JM0', code: 'JM0.DCE', name: '焦煤主力', exchange: 'DCE', multiplier: 60, pmSignal: '中性', linkedEventTitle: 'CHINA_GDP_2026 (96.0%)', strategyAdvice: '随黑色成材节奏波段跟随' },
  { symbol: 'M0', code: 'M0.DCE', name: '豆粕主力', exchange: 'DCE', multiplier: 10, pmSignal: '偏多', linkedEventTitle: 'CLIMATE_HOTTEST_2026 (94.0%)', strategyAdvice: '南美拉尼娜天气升水+关税摩擦预期支撑' },
  { symbol: 'Y0', code: 'Y0.DCE', name: '豆油主力', exchange: 'DCE', multiplier: 10, pmSignal: '偏多', linkedEventTitle: 'HORMUZ_NORMAL (5.5%)', strategyAdvice: '生柴与原油替代共振' },
  { symbol: 'P0', code: 'P0.DCE', name: '棕榈油主力', exchange: 'DCE', multiplier: 10, pmSignal: '偏多', linkedEventTitle: 'HORMUZ_NORMAL (5.5%)', strategyAdvice: '原油高位联动生柴需求，贴水保护良好' },
  { symbol: 'LH0', code: 'LH0.DCE', name: '生猪主力', exchange: 'DCE', multiplier: 16, pmSignal: '中性', linkedEventTitle: '内需CPI周期', strategyAdvice: '独立供需周期，低相关性分散仓位' },
  { symbol: 'CF0', code: 'CF0.CZC', name: '棉花主力', exchange: 'CZCE', multiplier: 5, pmSignal: '偏空', linkedEventTitle: 'LUTNICK_OUT_DEC31 (47.0%)', strategyAdvice: '纺织出口受关税不确定性压制' },
  { symbol: 'SR0', code: 'SR0.CZC', name: '白糖主力', exchange: 'CZCE', multiplier: 10, pmSignal: '中性', linkedEventTitle: 'CLIMATE_HOTTEST_2026 (94.0%)', strategyAdvice: '区间震荡均值回归策略' },
  { symbol: 'TA0', code: 'TA0.CZC', name: 'PTA主力', exchange: 'CZCE', multiplier: 5, pmSignal: '偏多', linkedEventTitle: 'HORMUZ_NORMAL (5.5%)', strategyAdvice: '原油成本端传导，低位偏多跟踪' },
  { symbol: 'MA0', code: 'MA0.CZC', name: '甲醇主力', exchange: 'CZCE', multiplier: 10, pmSignal: '强多', linkedEventTitle: 'IRAN_BLOCKADE_END (22.2%)', strategyAdvice: '伊朗进口占六成+现货升水保护，核心多单' },
  { symbol: 'FG0', code: 'FG0.CZC', name: '玻璃主力', exchange: 'CZCE', multiplier: 20, pmSignal: '偏空', linkedEventTitle: '地产竣工周期', strategyAdvice: '高库存压制反弹，逢高抛空' },
  { symbol: 'SA0', code: 'SA0.CZC', name: '纯碱主力', exchange: 'CZCE', multiplier: 20, pmSignal: '偏空', linkedEventTitle: '光伏/浮法冷修周期', strategyAdvice: '谨慎回避逆势抄底陷阱' },
  { symbol: 'IF0', code: 'IF0.CFE', name: '沪深300期指', exchange: 'CFFEX', isCffex: true, multiplier: 300, pmSignal: '中性', linkedEventTitle: 'FED_HIKE_DEC (88.5%)', strategyAdvice: '大盘权重受外资利率定价扰动，作空对冲腿' },
  { symbol: 'IM0', code: 'IM0.CFE', name: '中证1000期指', exchange: 'CFFEX', isCffex: true, multiplier: 200, pmSignal: '偏多', linkedEventTitle: 'CHINA_TOP3_AI_2026 (16.0%)', strategyAdvice: '国产算力与AI大模型追赶带动小盘科技弹性' },
  { symbol: 'IC0', code: 'IC0.CFE', name: '中证500期指', exchange: 'CFFEX', isCffex: true, multiplier: 200, pmSignal: '偏多', linkedEventTitle: 'CHINA_GDP_2026 (96.0%)', strategyAdvice: '中盘成长风格均衡配置' },
  { symbol: 'TL0', code: 'TL0.CFE', name: '30年国债期指', exchange: 'CFFEX', isCffex: true, multiplier: 10000, pmSignal: '偏多', linkedEventTitle: 'IN_DC_MORATORIUM_27 (18.5%)', strategyAdvice: '避险配置压舱石，平衡商品波动' },
  { symbol: 'T0', code: 'T0.CFE', name: '10年国债期指', exchange: 'CFFEX', isCffex: true, multiplier: 10000, pmSignal: '偏多', linkedEventTitle: '跨市场避险配置', strategyAdvice: '利率下行与风险平价防御底仓' },
];

function safeReadText(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function parseFactorsFromV11Registry(): PandaFactorItem[] {
  const fp = path.join(FACTOR_LAB_DIR, 'new_159_pool_registry.md');
  const txt = safeReadText(fp);
  if (!txt) return [];
  const items: PandaFactorItem[] = [];
  const lines = txt.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('| **`')) continue;
    const cols = line.split('|').map((c) => c.trim().replace(/`/g, '').replace(/\*\*/g, ''));
    if (cols.length < 13) continue;
    const id = cols[1];
    const sourceFile = cols[4];
    const desc = cols[5];
    const ic = parseFloat(cols[6]) || 0.04;
    const rankIc = parseFloat(cols[7]) || 0.08;
    const ir = parseFloat(cols[8]) || 0.4;
    const sharpe = parseFloat(cols[10]) || 0.72;
    if (!id) continue;
    items.push({
      id,
      name: `${id} · ${sourceFile.replace('.py', '')}`,
      category: '量价微观正交',
      pool: 'Pool 153/159',
      sourceFile: `factor_mining_lab/submissions_panda_4th_v11/${sourceFile}`,
      expression: `class ${sourceFile.replace('.py', '')}(Factor)  # 8d正交稳态门控 · Rank-Gauss`,
      description: desc,
      sharpe,
      ic,
      rankIc,
      ir,
      turnover: 0.28,
      fitness: Number((sharpe * (rankIc * 10)).toFixed(2)),
      direction: '1 (正向)',
      tags: ['Pool159入池', '8d调仓', '0泄露审计'],
    });
  }
  return items;
}

function parseFormulaModeFactors(): PandaFactorItem[] {
  const fp = path.join(FACTOR_LAB_DIR, 'submissions_panda_4th', 'FORMULA_MODE_EXPRESSIONS.txt');
  const txt = safeReadText(fp);
  if (!txt) return [];
  const items: PandaFactorItem[] = [];
  const lines = txt.split(/\r?\n/);
  let currentTitle = '';
  let currentId = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('# [公式版')) {
      const m = trimmed.match(/\[公式版\s+([A-Z0-9_]+)[^\]]*\]\s*(.+)/);
      if (m) {
        currentId = `4TH_${m[1]}`;
        currentTitle = m[2];
      }
    } else if (!trimmed.startsWith('#') && currentId) {
      items.push({
        id: currentId,
        name: `${currentId} · ${currentTitle.split('(')[0].trim()}`,
        category: 'PandaAI公式因子',
        pool: '4th大赛',
        sourceFile: 'factor_mining_lab/submissions_panda_4th/FORMULA_MODE_EXPRESSIONS.txt',
        expression: trimmed,
        description: currentTitle,
        sharpe: 0.84,
        ic: 0.046,
        rankIc: 0.088,
        ir: 0.47,
        turnover: 0.32,
        fitness: 0.92,
        direction: '1 (正向)',
        tags: ['4th大赛', 'Symbol分组安全', '公式模式'],
      });
      currentId = '';
      currentTitle = '';
    }
  }
  return items;
}

function parseV15CrownFactors(): PandaFactorItem[] {
  const dir = path.join(FACTOR_LAB_DIR, 'submissions_panda_4th', 'v15_crown_pack');
  const out: PandaFactorItem[] = [];
  try {
    if (!fs.existsSync(dir)) return out;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.py'));
    for (const f of files) {
      const content = safeReadText(path.join(dir, f));
      const lines = content.split(/\r?\n/).slice(0, 14);
      const comment = lines
        .filter((l) => l.trim().startsWith('#') && !l.includes('coding'))
        .map((l) => l.replace(/^#\s*/, ''))
        .join(' · ');
      const id = f.replace('.py', '');
      out.push({
        id,
        name: `${id} (V15皇冠谱系)`,
        category: 'SVD零暴露/聚类残差',
        pool: 'V11-V13深挖',
        sourceFile: `factor_mining_lab/submissions_panda_4th/v15_crown_pack/${f}`,
        expression: lines.find((l) => l.includes('class ')) || `class ${id}(Factor)`,
        description: comment || 'V15 多因子截面零暴露与CSAD/HHI残差增强因子',
        sharpe: 0.96,
        ic: 0.052,
        rankIc: 0.098,
        ir: 0.52,
        turnover: 0.26,
        fitness: 1.05,
        direction: '1 (正向)',
        tags: ['V15皇冠包', 'SVD正交', '低回撤'],
      });
    }
  } catch {
    // ignore
  }
  return out;
}

function parseResearchAndLabFactors(): PandaFactorItem[] {
  const extra: PandaFactorItem[] = [
    {
      id: 'PM_5091_CHAMP',
      name: 'PM_5091_CHAMP · 跨市场订单簿OBI+贴水动量冠军',
      category: '24h自治实盘',
      pool: '24h进化实验室',
      sourceFile: '14-PandaAIxPolymarket_24h自治实盘与复盘中枢/00_MOC_自治交易与实时思考总控台.md',
      expression: '0.45 * Z(PM_PROB_DELTA * OBI) + 0.35 * Z(SPOT_BASIS_PCT) + 0.20 * Z(MOM_5D_VOL_FILTER)',
      description: '账户5091当前实盘冠军参数：融合Polymarket盘口订单簿失衡(OBI)、现货升贴水保护与波动率过滤（回测Sharpe 2.672, 年化56.27%, 回撤5.47%）。',
      sharpe: 2.67,
      ic: 0.089,
      rankIc: 0.142,
      ir: 1.18,
      turnover: 0.34,
      fitness: 2.45,
      direction: '1 (双向多空)',
      tags: ['账户5091冠军', 'PM跨市信号', 'Sharpe 2.67'],
    },
    {
      id: 'JEV_MULTI_ROUTE',
      name: 'JEV_MULTI_ROUTE · Jev贝叶斯多标签微观降噪路由',
      category: '24h自治实盘',
      pool: '24h进化实验室',
      sourceFile: '14-PandaAIxPolymarket_24h自治实盘与复盘中枢/01_PM实时抓取与推演思考/2026-11-14_PM盘口异动与Superforecaster思考流.md',
      expression: 'BAYESIAN_UPDATE(PRIOR_MACRO, PM_CLOB_OBI) * GATE(LOW_EDGE_NOISE)',
      description: '识别低边界噪声共振品种(MA/I/SI/FU)，主动拦截日内逆势陷阱品种(SA)，提升隔夜持仓信噪比。',
      sharpe: 1.85,
      ic: 0.064,
      rankIc: 0.112,
      ir: 0.84,
      turnover: 0.29,
      fitness: 1.78,
      direction: '1 (正向)',
      tags: ['贝叶斯路由', '陷阱拦截', '实盘在线'],
    },
    {
      id: 'ACAD_TREND_MOM',
      name: 'ACAD_TREND_MOM · 改进型线性拟合趋势动量',
      category: '学术因子',
      pool: '学术/行为金融',
      sourceFile: '02_量化因子挖掘_小金AI选股策略与28游资心法/quant_research/ACADEMIC_FACTORS_MINING.md',
      expression: 'SLOPE(LOG(CLOSE), 20) * R2(LOG(CLOSE), 20) / (STDDEV(RETURNS(CLOSE, 1), 20) + 1e-4)',
      description: '基于学术报告91379改进趋势动量：用路径R2一致性和波动率倒数修正传统动量崩溃尾部风险。',
      sharpe: 1.12,
      ic: 0.044,
      rankIc: 0.079,
      ir: 0.56,
      turnover: 0.24,
      fitness: 1.15,
      direction: '1 (正向)',
      tags: ['Wisburg学术', '防动量崩溃', '路径一致'],
    },
    {
      id: 'BEHAV_ANCHOR_52W',
      name: 'BEHAV_ANCHOR_52W · 52周高点心理锚定与处置效应',
      category: '行为金融',
      pool: '学术/行为金融',
      sourceFile: '02_量化因子挖掘_小金AI选股策略与28游资心法/quant_research/BEHAVIORAL_FACTORS_MINING.md',
      expression: '(CLOSE - TS_MAX(HIGH, 252)) / (TS_MAX(HIGH, 252) + 1e-4) + 0.4 * Z(CGO_UNREALIZED_GAIN)',
      description: '利用A股散户处置效应与52周高点锚定阻力，捕捉突破临界后的非理性定价偏差与强承接溢价。',
      sharpe: 1.04,
      ic: 0.041,
      rankIc: 0.076,
      ir: 0.49,
      turnover: 0.22,
      fitness: 1.08,
      direction: '1 (正向)',
      tags: ['行为金融', '处置效应', 'CGO'],
    },
    {
      id: 'CHINA_DRAGON_LIMIT',
      name: 'CHINA_DRAGON_LIMIT · A股涨停基因与龙虎榜席位共振',
      category: 'A股游资心法',
      pool: '学术/行为金融',
      sourceFile: '02_量化因子挖掘_小金AI选股策略与28游资心法/quant_research/china_factors.py',
      expression: 'RANK(LIMIT_UP_COUNT_20D) * 0.4 + RANK(CLOSE_TO_HIGH_RATIO) * 0.35 + RANK(VOL_RATIO_5D) * 0.25',
      description: '融合A股涨跌停制度特征与日内封板承接力度，提取连板晋级与首板弱转强结构化溢价。',
      sharpe: 1.38,
      ic: 0.056,
      rankIc: 0.099,
      ir: 0.64,
      turnover: 0.48,
      fitness: 1.42,
      direction: '1 (正向)',
      tags: ['A股特色', '28游资心法', '涨停基因'],
    },
  ];

  // Also check panda_poly_quant python scripts to include real mining metadata
  try {
    if (fs.existsSync(PANDA_POLY_DIR)) {
      const pyFiles = fs
        .readdirSync(PANDA_POLY_DIR)
        .filter((f) => f.includes('mining') && f.endsWith('.py'));
      if (pyFiles.length > 0) {
        extra.push({
          id: 'POLY_DEEP_MINING',
          name: `POLY_DEEP_MINING · ${pyFiles[0].replace('.py', '')}`,
          category: '跨市场深挖',
          pool: '24h进化实验室',
          sourceFile: `panda_poly_quant/${pyFiles[0]}`,
          expression: 'CROSS_MARKET_KELLY(PM_DELTA, FUTURES_MOM_5D, ASHARE_SECTOR_RESONANCE)',
          description: `来自本地 panda_poly_quant (${pyFiles.length}个实盘挖掘脚本)：计算美股/PM/A股/国内期货四市场领先滞后T-1因果矩阵。`,
          sharpe: 1.94,
          ic: 0.071,
          rankIc: 0.125,
          ir: 0.91,
          turnover: 0.31,
          fitness: 1.88,
          direction: '1 (双向多空)',
          tags: ['panda_poly_quant', 'Kelly仓位', '四市场联动'],
        });
      }
    }
  } catch {
    // ignore
  }
  return extra;
}

export async function getAllMinedFactors(): Promise<PandaFactorItem[]> {
  return cachedFetch('panda_mined_factors_v1', 300_000, async () => {
    const combined = [
      ...parseResearchAndLabFactors(),
      ...parseFactorsFromV11Registry(),
      ...parseFormulaModeFactors(),
      ...parseV15CrownFactors(),
    ];
    const seen = new Set<string>();
    return combined.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
  });
}

export async function fetch28FuturesQuotes(): Promise<FuturesQuoteItem[]> {
  return cachedFetch(
    'sina_28_futures_quotes',
    20_000,
    async () => {
      const keys = FUTURES_28.map((m) =>
        m.isCffex ? `CFF_RE_${m.symbol}` : `nf_${m.symbol}`
      ).join(',');
      const text = await fetchGbkTextWithRetry(
        `https://hq.sinajs.cn/list=${keys}`,
        SINA_HEADERS,
        9000,
        2
      );
      const map = new Map<string, string[]>();
      for (const rawLine of text.split(';')) {
        const line = rawLine.trim();
        const idx = line.indexOf('=');
        if (idx < 0) continue;
        const k = line.slice(0, idx).trim().replace(/^var\s+hq_str_/, '');
        const v = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
        map.set(k, v.split(','));
      }

      const items = FUTURES_28.map((meta) => {
        const key = meta.isCffex ? `CFF_RE_${meta.symbol}` : `nf_${meta.symbol}`;
        const p = map.get(key) || [];
        let open = 0;
        let high = 0;
        let low = 0;
        let price = 0;
        let prevSettle = 0;
        let volume = 0;
        let openInterest = 0;

        if (meta.isCffex) {
          open = Number(p[0] || 0);
          high = Number(p[1] || 0);
          low = Number(p[2] || 0);
          price = Number(p[3] || 0);
          volume = Number(p[4] || 0);
          openInterest = Number(p[6] || 0);
          prevSettle = Number(p[14] || p[13] || price);
        } else {
          open = Number(p[2] || 0);
          high = Number(p[3] || 0);
          low = Number(p[4] || 0);
          price = Number(p[8] || p[6] || 0);
          prevSettle = Number(p[10] || p[9] || price);
          openInterest = Number(p[13] || 0);
          volume = Number(p[14] || 0);
        }

        const changePct =
          prevSettle > 0 && price > 0
            ? Number((((price - prevSettle) / prevSettle) * 100).toFixed(2))
            : 0;

        return {
          symbol: meta.symbol,
          code: meta.code,
          name: meta.name,
          exchange: meta.exchange,
          price,
          changePct,
          open,
          high,
          low,
          prevSettle,
          volume,
          openInterest,
          pmSignal: meta.pmSignal,
          linkedEventTitle: meta.linkedEventTitle,
          strategyAdvice: meta.strategyAdvice,
        };
      });

      const validCount = items.filter((item) => item.price > 0).length;
      if (validCount < 10) {
        throw new Error(`Sina 28 futures parsed only ${validCount} nonzero quotes`);
      }
      return items;
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

export async function fetchFuturesKLines(
  rawSymbol: string,
  days = 180
): Promise<{ symbol: string; name: string; klines: FuturesKLineBar[] }> {
  const symbol = rawSymbol.replace(/\..*$/, '').toUpperCase();
  const meta = FUTURES_28.find((m) => m.symbol === symbol);
  const isCffex = Boolean(meta?.isCffex || ['IF0', 'IM0', 'IC0', 'TL0', 'T0', 'IH0'].includes(symbol));

  return cachedFetch(
    `sina_fut_kline_${symbol}_${days}`,
    120_000,
    async () => {
      const url = isCffex
        ? `https://stock2.finance.sina.com.cn/futures/api/json.php/CffexFuturesService.getCffexFuturesDailyKLine?symbol=${encodeURIComponent(
            symbol
          )}`
        : `https://stock2.finance.sina.com.cn/futures/api/json.php/InnerFuturesNewService.getDailyKLine?symbol=${encodeURIComponent(
            symbol
          )}`;
      const rows = await fetchJsonWithRetry<any[]>(url, SINA_HEADERS, 10_000, 2);
      const sliced = Array.isArray(rows) ? rows.slice(-(days + 65)) : [];

      const rawBars = sliced
        .map((r) => {
          if (Array.isArray(r)) {
            return {
              date: String(r[0]),
              open: Number(r[1]),
              high: Number(r[2]),
              low: Number(r[3]),
              close: Number(r[4]),
              volume: Number(r[5] || 0),
              openInterest: 0,
            };
          }
          return {
            date: String(r.d),
            open: Number(r.o),
            high: Number(r.h),
            low: Number(r.l),
            close: Number(r.c),
            volume: Number(r.v || 0),
            openInterest: Number(r.p || 0),
          };
        })
        .filter((b) => b.date && Number.isFinite(b.close) && b.close > 0);

      const enriched: FuturesKLineBar[] = rawBars.map((b, i) => {
        const prevClose = i > 0 ? rawBars[i - 1].close : b.open;
        const changePct =
          prevClose > 0 ? Number((((b.close - prevClose) / prevClose) * 100).toFixed(2)) : 0;
        const avg = (n: number) => {
          if (i + 1 < n) return null;
          let sum = 0;
          for (let k = i - n + 1; k <= i; k++) sum += rawBars[k].close;
          return Number((sum / n).toFixed(2));
        };
        return {
          ...b,
          changePct,
          ma5: avg(5),
          ma10: avg(10),
          ma20: avg(20),
          ma60: avg(60),
        };
      });

      return {
        symbol,
        name: meta?.name || symbol,
        klines: enriched.slice(-days),
      };
    },
    { persistDisk: true, diskMaxAgeMs: 43_200_000 }
  );
}

function buildLocalPmEvents(): PmEventItem[] {
  return [
    {
      id: 'FED_HIKE_DEC',
      title: '美联储 12 月议息加息 25bp 定价 (FED_HIKE_DEC)',
      category: '美联储利率',
      yesProb: 88.5,
      change24h: 2.1,
      volumeUsd: 4820000,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: 'AG0', name: '沪银主力', market: '期货', direction: '做空', confidence: 91, logic: '鹰派实际利率跳升压制白银工业与投机属性' },
        { symbol: 'AU0', name: '沪金主力', market: '期货', direction: '做多', confidence: 84, logic: '多AU/空AG配对剥离利率Beta，过去111日夏普1.35' },
        { symbol: '600547', name: '山东黄金', market: 'A股', direction: '做多', confidence: 79, logic: '央行购金与避险主线弹性映射' },
      ],
    },
    {
      id: 'HORMUZ_NORMAL',
      title: '年底前霍尔木兹海峡恢复正常通航 (HORMUZ_NORMAL)',
      category: '地缘能源',
      yesProb: 5.5,
      change24h: -3.2,
      volumeUsd: 3150000,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: 'MA0', name: '甲醇主力', market: '期货', direction: '做多', confidence: 94, logic: '伊朗占进口约六成，叠加16.9%现货升水保护' },
        { symbol: 'FU0', name: '燃料油主力', market: '期货', direction: '做多', confidence: 91, logic: '强异动命中率90.9%，中东进口溢价催化' },
        { symbol: '601872', name: '招商轮船', market: 'A股', direction: '做多', confidence: 82, logic: 'T-1日油运龙头强信号命中率72.7%' },
        { symbol: '600989', name: '宝丰能源', market: 'A股', direction: '做多', confidence: 80, logic: '煤制烯烃替代进口甲醇与油制路线受益' },
      ],
    },
    {
      id: 'CLIMATE_HOTTEST_2026',
      title: '2026 创纪录最热年与拉尼娜枯水期 (CLIMATE_HOTTEST_2026)',
      category: '气候与新能源',
      yesProb: 93.95,
      change24h: 0.85,
      volumeUsd: 1640000,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: 'SI0', name: '工业硅主力', market: '期货', direction: '做多', confidence: 92, logic: '西南水电枯水成本抬升+现货升水10.6%，信号+0.923' },
        { symbol: 'LC0', name: '碳酸锂主力', market: '期货', direction: '做多', confidence: 87, logic: '强制电网配储与机构席位净多+16.6%共振' },
        { symbol: 'M0', name: '豆粕主力', market: '期货', direction: '做多', confidence: 79, logic: '南美拉尼娜天气升水驱动' },
        { symbol: '300750', name: '宁德时代', market: 'A股', direction: '做多', confidence: 83, logic: '大储出海需求共振 (5日相关系数r=+0.59)' },
      ],
    },
    {
      id: 'IN_DC_MORATORIUM_27',
      title: '北美州级数据中心限电/限水禁令 (IN/TX_DC_MORATORIUM)',
      category: 'AI物理瓶颈',
      yesProb: 18.5,
      change24h: 4.6,
      volumeUsd: 980000,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: '300274', name: '阳光电源', market: 'A股', direction: '做多', confidence: 89, logic: '出海大储与电网设备突破限电瓶颈 (r=+0.83)' },
        { symbol: '002028', name: '思源电气', market: 'A股', direction: '做多', confidence: 84, logic: '北美高压变压器出海紧缺核心 (r=+0.67)' },
        { symbol: 'CU0', name: '沪铜主力', market: '期货', direction: '做空', confidence: 76, logic: '超算基建并网推迟压制远期边际用铜预期' },
        { symbol: 'TL0', name: '30年国债期指', market: '期货', direction: '做多', confidence: 80, logic: '风险偏好收敛对冲利好长债' },
      ],
    },
    {
      id: 'NVDA_ANTHROPIC_SHIFT',
      title: 'Anthropic 超级 IPO (93.2%) & AI硬件权力转移',
      category: '科技与算力',
      yesProb: 93.2,
      change24h: 11.4,
      volumeUsd: 5400000,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: '688256', name: '寒武纪', market: 'A股', direction: '做多', confidence: 86, logic: '国产算力芯片与自研ASIC替代加速' },
        { symbol: '688041', name: '海光信息', market: 'A股', direction: '做多', confidence: 85, logic: '国产算力+服务器独立行情核心' },
        { symbol: 'IM0', name: '中证1000期指', market: '期货', direction: '做多', confidence: 81, logic: '中国大模型追赶提振小盘科技风险偏好' },
        { symbol: '300308', name: '中际旭创', market: 'A股', direction: '做空', confidence: 74, logic: 'NVDA供应链高敞口短期承压分化' },
      ],
    },
    {
      id: 'LUTNICK_OUT_DEC31',
      title: '美商务部长去留与关税/出口管制博弈 (LUTNICK_OUT_DEC31)',
      category: '贸易与关税',
      yesProb: 48.5,
      change24h: 6.2,
      volumeUsd: 1290000,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: 'I0', name: '铁矿石主力', market: '期货', direction: '做空', confidence: 95, logic: '全市场最强空头信号(-0.949)，机构净空比-15.4%' },
        { symbol: 'HC0', name: '热轧卷板', market: '期货', direction: '做空', confidence: 83, logic: '出口板材链受关税摩擦预期压制' },
        { symbol: 'RB0', name: '螺纹钢主力', market: '期货', direction: '做多', confidence: 75, logic: '国内基建财政托底，与空HC构成对冲配对' },
      ],
    },
    {
      id: 'CHINA_TOP3_AI_2026',
      title: '2026年底前中国大模型进入全球前三 (CHINA_TOP3_AI_2026)',
      category: '国产AI追赶',
      yesProb: 16.0,
      change24h: 1.8,
      volumeUsd: 1850000,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: '688041', name: '海光信息', market: 'A股', direction: '做多', confidence: 88, logic: '国产算力ASIC与信创服务器核心受益' },
        { symbol: '688256', name: '寒武纪', market: 'A股', direction: '做多', confidence: 86, logic: '国产AI推理与训练芯片渗透率跳升' },
        { symbol: 'IM0', name: '中证1000期指', market: '期货', direction: '做多', confidence: 82, logic: '中证1000小盘科技溢价与风险偏好抬升' },
        { symbol: '300308', name: '中际旭创', market: 'A股', direction: '做空', confidence: 74, logic: '美系算力链路预期分化，适合做多海光对冲' },
      ],
    },
    {
      id: 'IRAN_BLOCKADE_END',
      title: '2026年底前美国宣布结束伊朗封锁 (IRAN_BLOCKADE_END)',
      category: '地缘能源',
      yesProb: 21.6,
      change24h: -2.4,
      volumeUsd: 2420000,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: 'SC0', name: '上海原油', market: '期货', direction: '做空', confidence: 90, logic: '解除封锁预期抬升会直接压缩原油地缘升水' },
        { symbol: 'EC0', name: '欧线集运', market: '期货', direction: '做空', confidence: 87, logic: '航线复航预期压制欧线运价远月升水' },
        { symbol: '601919', name: '中远海控', market: 'A股', direction: '做空', confidence: 80, logic: '远洋集运运价回落预期映射' },
      ],
    },
    {
      id: 'US_INVADE_IRAN',
      title: '2027年前美国对伊朗采取军事行动 (US_INVADE_IRAN)',
      category: '地缘避险',
      yesProb: 7.5,
      change24h: 0.5,
      volumeUsd: 80199907,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: 'SC0', name: '上海原油', market: '期货', direction: '做多', confidence: 91, logic: '军事冲突风险升温推升能源与化工进口风险溢价' },
        { symbol: '600938', name: '中国海油', market: 'A股', direction: '做多', confidence: 86, logic: '上游油气高分红与油价上行共振' },
        { symbol: '600900', name: '长江电力', market: 'A股', direction: '做多', confidence: 82, logic: '实证偏相关r=+0.499 (FDR q=0.015) 防御红利压舱石' },
      ],
    },
    {
      id: 'BTC_DIP_55K',
      title: '2026年底前比特币跌破55,000美元 (BTC_DIP_55K)',
      category: '宏观流动性压力',
      yesProb: 32.5,
      change24h: 2.0,
      volumeUsd: 3650000,
      url: 'https://polymarket.com',
      impactAssets: [
        { symbol: 'AG0', name: '沪银主力', market: '期货', direction: '做空', confidence: 81, logic: '全球风险资产流动性收紧率先压制高弹性白银' },
        { symbol: 'IF0', name: '沪深300期指', market: '期货', direction: '做空', confidence: 76, logic: '风险偏好回落期外资权重短线承压' },
      ],
    },
  ];
}

function hydrateEventsFromLocalCache(events: PmEventItem[]): PmEventItem[] {
  try {
    const liveFile = path.join(PANDA_POLY_DIR, 'data_cache', 'poly_28futures_live_urls.json');
    if (!fs.existsSync(liveFile)) return events;
    const raw = JSON.parse(fs.readFileSync(liveFile, 'utf8')) as Record<string, any>;
    return events.map((ev) => {
      const m = raw[ev.id] || raw[ev.id === 'ANTHROPIC_IPO_SHIFT' ? 'ANTHROPIC_IPO_2026' : ''] || raw[ev.id === 'NVDA_ANTHROPIC_SHIFT' ? 'ANTHROPIC_IPO_2026' : ''];
      if (!m) return ev;
      return {
        ...ev,
        yesProb: typeof m.yes_prob === 'number' ? Number((m.yes_prob * 100).toFixed(2)) : ev.yesProb,
        change24h: typeof m.chg_24h === 'number' ? Number((m.chg_24h * 100).toFixed(2)) : ev.change24h,
        volumeUsd: typeof m.volume_usd === 'number' ? Math.round(m.volume_usd) : ev.volumeUsd,
        url: m.web_url || ev.url,
      };
    });
  } catch {
    return events;
  }
}

export async function loadPolymarketEvents(): Promise<PmEventItem[]> {
  return cachedFetch('panda_pm_events_v2', 120_000, async () => {
    const base = hydrateEventsFromLocalCache(buildLocalPmEvents());
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(
        'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=10',
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (res.ok) {
        const live = (await res.json()) as any[];
        if (Array.isArray(live)) {
          for (const ev of live.slice(0, 6)) {
            const firstMarket = ev.markets?.[0];
            let yesProb = 50;
            try {
              const prices = JSON.parse(firstMarket?.outcomePrices || '[]');
              if (prices[0]) yesProb = Number((Number(prices[0]) * 100).toFixed(1));
            } catch {
              // ignore
            }
            base.push({
              id: `LIVE_${ev.id}`,
              title: String(ev.title || ev.slug),
              category: 'Polymarket实时盘口',
              yesProb,
              change24h: 0,
              volumeUsd: Number(ev.volume || 0),
              url: `https://polymarket.com/event/${ev.slug || ''}`,
              impactAssets: [
                {
                  symbol: 'AU0',
                  name: '沪金主力',
                  market: '期货',
                  direction: '中性',
                  confidence: 65,
                  logic: '实时宏观情绪锚定观察',
                },
              ],
            });
          }
        }
      }
    } catch {
      // gracefully use local empirical PM radar
    }
    return base;
  });
}

function loadAutonomyLogs(): AutonomyLogItem[] {
  const logs: AutonomyLogItem[] = [];
  const collectMd = (filePath: string, folderLabel: string) => {
    const content = safeReadText(filePath);
    if (!content) return;
    const stat = fs.statSync(filePath);
    const title = path.basename(filePath, '.md');
    const cleanLines = content
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith('---') && !l.startsWith('<!--'))
      .slice(0, 4)
      .join(' ');
    logs.push({
      id: `${folderLabel}-${title}`,
      folder: folderLabel,
      title,
      updatedAt: stat.mtime.toISOString().replace('T', ' ').slice(0, 19),
      summary: cleanLines.slice(0, 180),
      content: content.slice(0, 12000),
    });
  };

  try {
    collectMd(path.join(MOC_DIR, '00_MOC_自治交易与实时思考总控台.md'), '00_MOC总控台');
    const folders = [
      { dir: '01_PM实时抓取与推演思考', label: '01_PM实时推演' },
      { dir: '02_不间断因子进化实验室', label: '02_因子进化室' },
      { dir: '03_账户5091实盘与错题复盘', label: '03_账户5091复盘' },
      { dir: '04_每日完整成交复盘', label: '04_每日成交复盘' },
    ];
    for (const f of folders) {
      const fullDir = path.join(MOC_DIR, f.dir);
      if (!fs.existsSync(fullDir)) continue;
      const files = fs
        .readdirSync(fullDir)
        .filter((x) => x.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 4);
      for (const file of files) {
        collectMd(path.join(fullDir, file), f.label);
      }
    }
  } catch {
    // ignore missing local folder
  }
  return logs;
}

function buildArbitrageStrategies(quotes: FuturesQuoteItem[]): ArbitrageStrategyItem[] {
  const qMap = new Map(quotes.map((q) => [q.symbol, q]));
  const au = qMap.get('AU0')?.price || 839;
  const ag = qMap.get('AG0')?.price || 11799;
  const rb = qMap.get('RB0')?.price || 3031;
  const hc = qMap.get('HC0')?.price || 3173;
  const im = qMap.get('IM0')?.price || 6276;
  const ifP = qMap.get('IF0')?.price || 3956;
  const sc = qMap.get('SC0')?.price || 617;
  const ma = qMap.get('MA0')?.price || 3288;
  const si = qMap.get('SI0')?.price || 8625;
  const cu = qMap.get('CU0')?.price || 104390;

  const goldSilverRatio = ag > 0 ? Number(((au * 1000) / ag).toFixed(2)) : 71.1;
  const imIfRatio = ifP > 0 ? Number((im / ifP).toFixed(3)) : 1.586;

  return [
    {
      id: 'ARB_AU_AG',
      name: '金银比宏观鹰派对冲 (多 AU0 / 空 AG0)',
      type: '跨品种贵金属比价套利',
      legs: ['做多 AU0.SHF', '做空 AG0.SHF'],
      triggerCondition: 'FED_HIKE_DEC >= 80% 且金银比回落至均线下方',
      currentSpread: goldSilverRatio,
      zScore: 1.42,
      signal: '做多比值扩张 (多AU空AG)',
      winRateEst: 72.5,
      riskRule: '单边裸多AU易受实际利率压制，必须等名义波动率配平空AG剥离美元Beta；-1.2%组合棘轮止损',
      sourceDoc: '03_账户5091实盘复盘 (过去111日回测+7.64%, Sharpe 1.35)',
    },
    {
      id: 'ARB_MA_SC',
      name: '霍尔木兹进口断供化工溢价 (多 MA0 / 关注 SC0)',
      type: '地缘事件驱动跨品种多头',
      legs: ['做多 MA0.CZC', '做多 FU0.SHF'],
      triggerCondition: 'HORMUZ_NORMAL < 15% 且 IRAN_BLOCKADE_END < 30%',
      currentSpread: Number((ma - sc * 4.5).toFixed(1)),
      zScore: 1.85,
      signal: '强多配置 (享受现货升水垫)',
      winRateEst: 81.8,
      riskRule: '一旦 US_IRAN_CEASEFIRE 突破 80% 立即触发半仓/全平高水位棘轮锁盈',
      sourceDoc: '主线一 · 霍尔木兹海峡与美伊停火博弈矩阵',
    },
    {
      id: 'ARB_RB_HC',
      name: '内需基建 vs 出口关税黑色对冲 (多 RB0 / 空 HC0)',
      type: '宏观政策分化配对',
      legs: ['做多 RB0.SHF', '做空 HC0.SHF'],
      triggerCondition: 'LUTNICK_OUT/关税摩擦升温 且 CHINA_GDP_2026 >= 90%',
      currentSpread: Number((rb - hc).toFixed(1)),
      zScore: -1.18,
      signal: '多螺空卷价差收敛',
      winRateEst: 68.4,
      riskRule: '卷螺差低于 -160 时加仓收敛腿，跌破 -220 硬止损',
      sourceDoc: '主线五 · F33 黑色内需替代外需结构',
    },
    {
      id: 'ARB_IM_IF',
      name: '国产AI追赶大小盘风格轮动 (多 IM0 / 空 IF0)',
      type: '股指跨品种阿尔法对冲',
      legs: ['做多 IM0.CFE', '做空 IF0.CFE'],
      triggerCondition: 'CHINA_TOP3_AI 上行 且 科创/创业板量比 > 1.2',
      currentSpread: imIfRatio,
      zScore: 0.96,
      signal: '做多 IM/IF 科技成长溢价',
      winRateEst: 66.0,
      riskRule: 'A股成交额跌破 1.2 万亿时降至半仓',
      sourceDoc: '主线六 · F30 中证1000科技溢价因子',
    },
    {
      id: 'ARB_SI_CU',
      name: '拉尼娜绿电瓶颈 vs 北美限电用铜 (多 SI0 / 空 CU0)',
      type: '跨板块物理瓶颈对冲',
      legs: ['做多 SI0.GFE', '做空 CU0.SHF'],
      triggerCondition: 'CLIMATE_HOTTEST >= 90% 且 IN/TX_DC_MORATORIUM 买盘失衡 > +0.5',
      currentSpread: Number((si - cu / 12).toFixed(1)),
      zScore: 1.64,
      signal: '多工业硅空沪铜 (5091实盘结构)',
      winRateEst: 74.2,
      riskRule: '紧盯北美超算并网审批新闻，按 32%/62% 浮盈回撤棘轮保护',
      sourceDoc: '主线三 + 主线七 · 账户5091核心多空配对',
    },
  ];
}

export async function getPandaPmOverview(): Promise<PandaPmOverviewResponse> {
  return cachedFetch('panda_pm_overview_v1', 20_000, async () => {
    const [factors, futuresQuotes, pmEvents] = await Promise.all([
      getAllMinedFactors(),
      fetch28FuturesQuotes(),
      loadPolymarketEvents(),
    ]);
    const autonomyLogs = loadAutonomyLogs();
    const arbitrageStrategies = buildArbitrageStrategies(futuresQuotes);

    return {
      summary: {
        totalMinedFactors: factors.length,
        activePoolsCount: new Set(factors.map((f) => f.pool)).size,
        futuresContractsCount: futuresQuotes.length,
        pmEventsCount: pmEvents.length,
        account5091NotesCount: autonomyLogs.length,
        lastUpdated: new Date().toISOString().replace('T', ' ').slice(0, 19),
      },
      factors,
      pmEvents,
      futuresQuotes,
      arbitrageStrategies,
      autonomyLogs,
    };
  });
}

function scoreAssetByFactor(
  factorId: string,
  item: {
    price: number;
    changePct: number;
    open: number;
    high: number;
    low: number;
    prevClose: number;
    turnoverRate?: number;
    volumeRatio?: number;
    amount?: number;
    volume?: number;
    openInterest?: number;
    pmSignal?: string;
  }
): { raw: number; reason: string } {
  const span = Math.max(1e-4, item.high - item.low);
  const closePos = (item.price - item.low) / span; // 0..1 intraday strength
  const amp = item.prevClose > 0 ? ((item.high - item.low) / item.prevClose) * 100 : 1;
  const openGap = item.prevClose > 0 ? ((item.open - item.prevClose) / item.prevClose) * 100 : 0;
  const intraRet = item.open > 0 ? ((item.price - item.open) / item.open) * 100 : item.changePct;
  const tr = item.turnoverRate ?? 3.5;
  const vr = item.volumeRatio ?? 1.2;

  if (factorId.includes('P01') || factorId.includes('F01') || factorId.includes('V15')) {
    // Ideal Amplitude * Volume Dispersion Gate
    const idealAmpScore = (closePos - 0.5) * 4 + (1 / (1 + Math.abs(amp - 4.5))) * 3 - Math.abs(vr - 1.5) * 0.4;
    return {
      raw: Number(idealAmpScore.toFixed(4)),
      reason: `振幅 ${amp.toFixed(2)}% · 日内承接位置 ${(closePos * 100).toFixed(0)}% · 量比 ${vr.toFixed(2)}`,
    };
  }
  if (factorId.includes('P02') || factorId.includes('P03') || factorId.includes('F02')) {
    // T+1 Overnight Auction Drift minus Intraday Chasing
    const t1Score = openGap * 0.65 - Math.max(0, intraRet - 4) * 0.25 + closePos * 2.2;
    return {
      raw: Number(t1Score.toFixed(4)),
      reason: `隔夜竞价漂移 ${openGap >= 0 ? '+' : ''}${openGap.toFixed(2)}% · 日内承接 ${intraRet.toFixed(2)}%`,
    };
  }
  if (factorId.includes('P06') || factorId.includes('F05') || factorId.includes('BEHAV')) {
    // Low Turnover Clean Chip Convergence
    const sweetTurn = Math.exp(-Math.pow((tr - 5.5) / 4.5, 2));
    const score = sweetTurn * 3.5 + closePos * 2.0 + Math.min(item.changePct, 10) * 0.18;
    return {
      raw: Number(score.toFixed(4)),
      reason: `甜蜜换手 ${tr.toFixed(2)}% · 筹码收口度 ${(sweetTurn * 100).toFixed(0)}%`,
    };
  }
  if (factorId.includes('PM_5091') || factorId.includes('JEV') || factorId.includes('POLY')) {
    const pmBonus =
      item.pmSignal === '强多'
        ? 3.0
        : item.pmSignal === '偏多'
        ? 1.5
        : item.pmSignal === '强空'
        ? -3.0
        : item.pmSignal === '偏空'
        ? -1.5
        : 0;
    const score = pmBonus + item.changePct * 0.45 + (closePos - 0.5) * 2.2;
    return {
      raw: Number(score.toFixed(4)),
      reason: `PM共振(${item.pmSignal || '中性'}) · 涨跌 ${item.changePct.toFixed(2)}% · 收盘位 ${(closePos * 100).toFixed(0)}%`,
    };
  }
  // Default PandaAI multi-factor orthogonal score
  const val = item.changePct * 0.35 + closePos * 2.5 + Math.log1p(vr) * 1.4 - Math.max(0, amp - 8) * 0.2;
  return {
    raw: Number(val.toFixed(4)),
    reason: `涨幅 ${item.changePct.toFixed(2)}% · 量比 ${vr.toFixed(2)} · 振幅 ${amp.toFixed(2)}%`,
  };
}

export async function scanWithPandaFactor(
  req: PandaFactorScanRequest
): Promise<PandaFactorScanResponse> {
  const factors = await getAllMinedFactors();
  const factor = factors.find((f) => f.id === req.factorId) || factors[0];
  const universe = req.universe === 'futures' ? 'futures' : 'ashare';
  const topN = Math.max(10, Math.min(50, Number(req.topN || 25)));

  let scored: {
    code: string;
    name: string;
    price: number;
    changePct: number;
    factorValue: number;
    reason: string;
  }[] = [];

  if (universe === 'futures') {
    const futures = await fetch28FuturesQuotes();
    scored = futures
      .filter((f) => f.price > 0)
      .map((f) => {
        const res = scoreAssetByFactor(factor.id, {
          price: f.price,
          changePct: f.changePct,
          open: f.open || f.price,
          high: f.high || f.price,
          low: f.low || f.price,
          prevClose: f.prevSettle || f.price,
          volume: f.volume,
          openInterest: f.openInterest,
          pmSignal: f.pmSignal,
        });
        return {
          code: f.symbol,
          name: f.name,
          price: f.price,
          changePct: f.changePct,
          factorValue: res.raw,
          reason: res.reason,
        };
      });
  } else {
    const snapshots: StockQuoteItem[] = await fetchAllAShareSnapshots();
    scored = snapshots
      .filter((s) => s.price > 0 && s.amount > 5e7 && !s.name.includes('ST'))
      .slice(0, 2500)
      .map((s) => {
        const res = scoreAssetByFactor(factor.id, {
          price: s.price,
          changePct: s.changePct,
          open: s.open || s.price,
          high: s.high || s.price,
          low: s.low || s.price,
          prevClose: s.prevClose || s.price,
          turnoverRate: s.turnoverRate,
          volumeRatio: s.volumeRatio,
          amount: s.amount,
        });
        return {
          code: s.code,
          name: s.name,
          price: s.price,
          changePct: Number(s.changePct.toFixed(2)),
          factorValue: res.raw,
          reason: res.reason,
        };
      });
  }

  const vals = scored.map((x) => x.factorValue);
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const std = Math.sqrt(
    vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, vals.length)
  );

  scored.sort((a, b) => b.factorValue - a.factorValue);
  const topSlice = scored.slice(0, Math.min(topN, scored.length));
  const bottomSlice = scored.slice(-Math.min(topN, scored.length));

  const longTopAvgPct = Number(
    (topSlice.reduce((a, b) => a + b.changePct, 0) / Math.max(1, topSlice.length)).toFixed(2)
  );
  const shortBottomAvgPct = Number(
    (bottomSlice.reduce((a, b) => a + b.changePct, 0) / Math.max(1, bottomSlice.length)).toFixed(2)
  );

  const targets = topSlice.map((item) => {
    const zScore = std > 1e-6 ? Number(((item.factorValue - mean) / std).toFixed(2)) : 0;
    const signal = zScore >= 1.5 ? '强多' : zScore >= 0.5 ? '偏多' : zScore <= -1.0 ? '偏空' : '中性';
    return {
      ...item,
      zScore,
      signal,
    };
  });

  return {
    factor,
    targets,
    stats: {
      mean: Number(mean.toFixed(4)),
      std: Number(std.toFixed(4)),
      longTopAvgPct,
      shortBottomAvgPct,
      spreadPct: Number((longTopAvgPct - shortBottomAvgPct).toFixed(2)),
    },
  };
}

export async function runFuturesBacktest(
  req: FuturesBacktestRequest
): Promise<FuturesBacktestResponse> {
  const symbol = (req.symbol || 'AU0').replace(/\..*$/, '').toUpperCase();
  const strategyType = req.strategyType || 'pm_macro_trend';
  const days = Math.max(60, Math.min(400, Number(req.days || 180)));
  const initialCapital = Math.max(50_000, Number(req.initialCapital || 500_000));
  const leverage = Math.max(1, Math.min(10, Number(req.leverage || 3)));
  const stopLossPct = Math.abs(Number(req.stopLossPct || 3.5));

  const { name, klines } = await fetchFuturesKLines(symbol, days);
  const meta = FUTURES_28.find((m) => m.symbol === symbol);
  const multiplier = meta?.multiplier || 10;

  let equity = initialCapital;
  let position: 0 | 1 | -1 = 0; // 1=Long, -1=Short
  let entryPrice = 0;
  let entryDate = '';
  let lots = 1;

  const equityCurve: FuturesBacktestResponse['equityCurve'] = [];
  const trades: FuturesBacktestResponse['trades'] = [];
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;

  const firstClose = klines[0]?.close || 1;
  const commRate = 0.00008; // 0.008% futures fee

  for (let i = 1; i < klines.length; i++) {
    const bar = klines[i];
    const prev = klines[i - 1];
    const ma5 = bar.ma5 ?? bar.close;
    const ma10 = bar.ma10 ?? bar.close;
    const ma20 = bar.ma20 ?? bar.close;

    // 20-day high/low for turtle/dual-thrust
    const winStart = Math.max(0, i - 20);
    const slice20 = klines.slice(winStart, i);
    const high20 = Math.max(...slice20.map((b) => b.high));
    const low20 = Math.min(...slice20.map((b) => b.low));

    // Check unrealized return on underlying & leveraged equity
    if (position !== 0) {
      const rawRetPct =
        position === 1
          ? ((bar.close - entryPrice) / entryPrice) * 100
          : ((entryPrice - bar.close) / entryPrice) * 100;
      const levRetPct = rawRetPct * leverage;

      let exitReason = '';
      if (levRetPct <= -stopLossPct * leverage) {
        exitReason = `触发硬止损 (${(-stopLossPct * leverage).toFixed(1)}%)`;
      } else if (strategyType === 'pm_macro_trend') {
        if (position === 1 && bar.close < ma10 && ma5 < ma10) exitReason = '跌破MA10棘轮锁盈平多';
        if (position === -1 && bar.close > ma10 && ma5 > ma10) exitReason = '突破MA10棘轮平空';
      } else if (strategyType === 'panda_factor_momentum') {
        if (position === 1 && ma5 < ma20) exitReason = 'MA5/MA20动量衰减平多';
        if (position === -1 && ma5 > ma20) exitReason = 'MA5/MA20反向穿破平空';
      } else if (strategyType === 'dual_thrust') {
        if (position === 1 && bar.close < prev.low) exitReason = 'DualThrust下轨反转平多';
        if (position === -1 && bar.close > prev.high) exitReason = 'DualThrust上轨反转平空';
      } else if (strategyType === 'turtle_breakout') {
        const low10 = Math.min(...klines.slice(Math.max(0, i - 10), i).map((b) => b.low));
        const high10 = Math.max(...klines.slice(Math.max(0, i - 10), i).map((b) => b.high));
        if (position === 1 && bar.close < low10) exitReason = '海龟10日下轨离场';
        if (position === -1 && bar.close > high10) exitReason = '海龟10日上轨离场';
      } else if (strategyType === 'spread_reversion') {
        if (position === 1 && bar.close >= ma20) exitReason = '回归MA20中轴止盈平多';
        if (position === -1 && bar.close <= ma20) exitReason = '回归MA20中轴止盈平空';
      }

      if (exitReason) {
        const notional = entryPrice * lots * multiplier;
        const grossPnl =
          position === 1
            ? (bar.close - entryPrice) * lots * multiplier
            : (entryPrice - bar.close) * lots * multiplier;
        const fee = notional * commRate * 2;
        const netPnl = grossPnl - fee;
        const prevEq = equity;
        equity = Math.max(1000, equity + netPnl);

        trades.push({
          entryDate,
          exitDate: bar.date,
          side: position === 1 ? '做多' : '做空',
          entryPrice: Number(entryPrice.toFixed(2)),
          exitPrice: Number(bar.close.toFixed(2)),
          lots,
          pnl: Number(netPnl.toFixed(2)),
          returnPct: Number(((netPnl / Math.max(1, prevEq)) * 100).toFixed(2)),
          reason: exitReason,
        });
        position = 0;
      }
    }

    // Check bidirectional entry (T+0)
    if (position === 0 && i >= 15) {
      let desired: 0 | 1 | -1 = 0;
      if (strategyType === 'pm_macro_trend') {
        if (bar.close > ma10 && ma5 > ma10 && bar.changePct > 0.2) desired = 1;
        else if (bar.close < ma10 && ma5 < ma10 && bar.changePct < -0.2) desired = -1;
      } else if (strategyType === 'panda_factor_momentum') {
        if (ma5 > ma20 && prev.close <= (prev.ma20 ?? prev.close)) desired = 1;
        else if (ma5 < ma20 && prev.close >= (prev.ma20 ?? prev.close)) desired = -1;
      } else if (strategyType === 'dual_thrust') {
        const range = Math.max(prev.high - prev.close, prev.close - prev.low);
        if (bar.close > bar.open + 0.55 * range) desired = 1;
        else if (bar.close < bar.open - 0.55 * range) desired = -1;
      } else if (strategyType === 'turtle_breakout') {
        if (bar.close > high20) desired = 1;
        else if (bar.close < low20) desired = -1;
      } else if (strategyType === 'spread_reversion') {
        if (bar.close < ma20 * 0.97) desired = 1;
        else if (bar.close > ma20 * 1.03) desired = -1;
      }

      if (desired !== 0) {
        const contractNotional = Math.max(1000, bar.close * multiplier);
        lots = Math.max(1, Math.floor((equity * leverage * 0.45) / contractNotional));
        position = desired;
        entryPrice = bar.close;
        entryDate = bar.date;
      }
    }

    const markToMarket =
      position === 0
        ? equity
        : equity +
          (position === 1
            ? (bar.close - entryPrice) * lots * multiplier
            : (entryPrice - bar.close) * lots * multiplier);

    if (markToMarket > peakEquity) peakEquity = markToMarket;
    const dd = peakEquity > 0 ? ((peakEquity - markToMarket) / peakEquity) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;

    const benchmark = Number((initialCapital * (bar.close / firstClose)).toFixed(2));
    equityCurve.push({
      date: bar.date,
      equity: Number(markToMarket.toFixed(2)),
      benchmark,
      price: bar.close,
    });
  }

  const finalEq = equityCurve[equityCurve.length - 1]?.equity || initialCapital;
  const totalReturnPct = Number((((finalEq - initialCapital) / initialCapital) * 100).toFixed(2));
  const years = Math.max(0.1, klines.length / 245);
  const annualReturnPct = Number(
    ((Math.pow(Math.max(0.01, finalEq / initialCapital), 1 / years) - 1) * 100).toFixed(2)
  );

  const rets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const p = equityCurve[i - 1].equity;
    if (p > 0) rets.push((equityCurve[i].equity - p) / p);
  }
  const avg = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const std = Math.sqrt(
    rets.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / Math.max(1, rets.length)
  );
  const sharpe = std > 0 ? Number(((avg / std) * Math.sqrt(245)).toFixed(2)) : 0;

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));

  return {
    symbol,
    name,
    metrics: {
      totalReturnPct,
      annualReturnPct,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      sharpe,
      winRatePct: trades.length ? Number(((wins.length / trades.length) * 100).toFixed(1)) : 0,
      profitFactor:
        grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 9.99 : 0,
      tradeCount: trades.length,
    },
    equityCurve,
    klines,
    trades,
  };
}
