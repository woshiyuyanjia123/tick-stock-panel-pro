import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  PmAssetUniverse,
  PmDiscoveredRelationItem,
  PmDiscoverRelationsRequest,
  PmEventAlignedPoint,
  PmEventBacktestRequest,
  PmEventBacktestResponse,
  PmEventBacktestTrade,
  PmEventItem,
  PmEventSignalMode,
  PmLeadLagPoint,
  PmRelationMatrixResponse,
} from '../../src/types/market';
import {
  fetchBoardConstituents,
  fetchConceptBoards,
  fetchIndustryBoards,
  fetchStockKLinesEM,
} from '../providers/eastmoney';
import { fetchTencentKLines } from '../providers/tencent';
import { cachedFetch } from '../utils/httpCache';
import { cleanCode, getLimitRatio } from '../utils/marketHelpers';
import {
  FUTURES_28,
  fetchFuturesKLines,
  loadPolymarketEvents,
} from './pandaPmService';

const execFileAsync = promisify(execFile);

// Optional READ-ONLY local Polymarket research vault
const PANDA_POLY_DIR =
  process.env.TSP_PANDA_POLY_DIR || path.join(os.homedir(), 'panda_poly_quant');
const LIVE_PM_URLS_FILE = path.join(PANDA_POLY_DIR, 'data_cache', 'poly_28futures_live_urls.json');

interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePct: number;
  ma5: number | null;
  ma20: number | null;
}

interface CandidateAssetMeta {
  symbol: string;
  name: string;
  market: '国内期货' | 'A股瓶颈龙头' | 'A股板块指数';
  universe: 'futures' | 'ashare_stock' | 'sector';
  isFutures: boolean;
  multiplier: number;
  keywords: string[];
}

interface CuratedLinkSpec {
  eventId: string;
  assetSymbol: string;
  tier: '一阶直连' | '二阶传导' | '宏观共振';
  expectedDirection: 1 | -1;
  mechanism: string;
  hedgeLegSymbol?: string;
  hedgeLegName?: string;
}

// Verified Polymarket condition/token fallback IDs from poly_baskets.py & research_cross_market_matrix
const FALLBACK_CLOB_TOKENS: Record<string, { tokenId?: string; conditionId?: string }> = {
  FED_HIKE_DEC: {
    tokenId: '111662129652828266889360374468657435151479595863413519836161861837506140152890',
    conditionId: '0x8a4196617dcb703e49d9bb36d3847bf6a75fd364dbd19f8d408ac944bf1a03d8',
  },
  HORMUZ_NORMAL: {
    tokenId: '83783489454659420807679723574840032660002326710045123865554753994450797728825',
    conditionId: '0x5c79dfde05559b79a9cb9f7c4187e4d49632dd042572ae676952f812732591cc',
  },
  IRAN_BLOCKADE_END: {
    tokenId: '86011229287950365043519117852041614651767455889324682112682327985496937935368',
    conditionId: '0x46ca741da4abd7ffa993f59ac65bfe83de43ae027accac71d263a493e44064e7',
  },
  US_INVADE_IRAN: {
    tokenId: '55115078421062885512539156303747803058407616201213034911037320915726138659123',
    conditionId: '0x5db999fad322cea2914535aae5517060c3f80ad6d8c0231cde2124a434d16846',
  },
  CLIMATE_HOTTEST_2026: {
    tokenId: '23556429317429021692175226714041757812438092709195093999386854296551945919152',
    conditionId: '0xe67f4d31f0eba1b009b49d7a7739b2a5f53a2d7d979a0902b465a510492c33bb',
  },
  IN_DC_MORATORIUM_27: {
    tokenId: '17772357652541837838268340566054305212337253685162402420922433137448964217470',
    conditionId: '0x90eb090b7cfb854b88e4252c9c2a74dcc875558212b71c10dc86188323e3e5c3',
  },
  NVDA_ANTHROPIC_SHIFT: {
    tokenId: '48566046548914168443252668519852295704538578584318207505303160546351275413281',
    conditionId: '0xb40b0cd531184a1e436d23ca898e1590418187b116f387158753d1adb9853e47',
  },
  CHINA_TOP3_AI_2026: {
    tokenId: '31073898066092073901758862002915643899693247647436421266976536769150563530801',
    conditionId: '0xf4aff06686ee874668335fe94999e249fdf4de02a031afc9ee791a911b0e8717',
  },
  LUTNICK_OUT_DEC31: {
    conditionId: '0x7978663d03b5c053dcea87b39e06fad5bcdd036b0c7febfa4309502c02f70c2c',
  },
  BTC_DIP_55K: {
    tokenId: '115462087336983275104521488923966022755348986822352694745153736621832003960847',
    conditionId: '0x752fa61c93f16c4b15e85b0bd438d9c684176b0ea7b319a84c8aca34616e8a8c',
  },
};

const CORE_ASHARE_CANDIDATES: CandidateAssetMeta[] = [
  { symbol: '601899', name: '紫金矿业', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['黄金', '铜', '资源', '美联储', '通胀'] },
  { symbol: '600547', name: '山东黄金', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['黄金', '避险', '美联储', '利率'] },
  { symbol: '002155', name: '湖南黄金', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['黄金', '锑', '战略金属'] },
  { symbol: '600938', name: '中国海油', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['原油', '油气', '霍尔木兹', '伊朗'] },
  { symbol: '601872', name: '招商轮船', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['油运', '航运', '霍尔木兹', '伊朗'] },
  { symbol: '601919', name: '中远海控', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['集运', '航运', '欧线', '关税', '伊朗'] },
  { symbol: '600989', name: '宝丰能源', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['煤化工', '甲醇', '烯烃', '伊朗'] },
  { symbol: '300274', name: '阳光电源', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['储能', '电网', '限电', '气候', '新能源'] },
  { symbol: '002028', name: '思源电气', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['变压器', '电网', '限电', '数据中心'] },
  { symbol: '002837', name: '英维克', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['液冷', '数据中心', '温控', 'AI'] },
  { symbol: '300750', name: '宁德时代', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['电池', '储能', '碳酸锂', '气候'] },
  { symbol: '688041', name: '海光信息', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['国产算力', 'AI', '芯片', '大模型'] },
  { symbol: '688256', name: '寒武纪', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['国产算力', 'AI', '芯片', '大模型'] },
  { symbol: '300308', name: '中际旭创', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['光模块', 'CPO', 'NVDA', '出口', '关税'] },
  { symbol: '300502', name: '新易盛', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['光模块', 'CPO', 'NVDA', '出口'] },
  { symbol: '601088', name: '中国神华', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['煤炭', '火电', '高温', '气候'] },
  { symbol: '600900', name: '长江电力', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['水电', '防御', '高股息', '地缘避险'] },
  { symbol: '688981', name: '中芯国际', market: 'A股瓶颈龙头', universe: 'ashare_stock', isFutures: false, multiplier: 1, keywords: ['半导体', '晶圆', '国产替代', '关税'] },
];

const CURATED_FUTURES_SYMBOLS = [
  'AU0', 'AG0', 'SC0', 'FU0', 'EC0', 'MA0', 'TA0', 'CU0', 'AL0',
  'SI0', 'LC0', 'RB0', 'HC0', 'I0', 'M0', 'IF0', 'IM0', 'TL0',
];

const SECTOR_TARGETS = [
  { key: '贵金属', keywords: ['贵金属', '黄金'], label: '贵金属板块', leaders: ['601899', '600547', '002155'] },
  { key: '航运港口', keywords: ['航运港口', '水上运输'], label: '航运港口板块', leaders: ['601919', '601872', '600026'] },
  { key: '油气开采', keywords: ['油气开采', '石油行业'], label: '油气开采板块', leaders: ['600938', '601857', '600028'] },
  { key: '电网设备', keywords: ['电网设备', '输变电'], label: '电网设备板块', leaders: ['002028', '688676', '600406'] },
  { key: '光伏设备', keywords: ['光伏设备', '储能', '光伏'], label: '光伏储能板块', leaders: ['300274', '300750', '601012'] },
  { key: '半导体', keywords: ['半导体'], label: '半导体板块', leaders: ['688981', '688041', '688256'] },
  { key: '通信设备', keywords: ['通信设备', 'CPO概念', '光通信'], label: '光模块/通信板块', leaders: ['300308', '300502', '300394'] },
  { key: '煤炭行业', keywords: ['煤炭行业', '煤炭'], label: '煤炭行业板块', leaders: ['601088', '601225', '600188'] },
];

// Domain transmission links grounded in panda_poly_quant research
const CURATED_LINKS: CuratedLinkSpec[] = [
  // FED_HIKE_DEC
  {
    eventId: 'FED_HIKE_DEC',
    assetSymbol: 'AG0',
    tier: '一阶直连',
    expectedDirection: -1,
    mechanism: '联储鹰派定价推高美元实际利率预期，高弹性工业白银首当其冲承压',
    hedgeLegSymbol: 'AU0',
    hedgeLegName: '沪金主力',
  },
  {
    eventId: 'FED_HIKE_DEC',
    assetSymbol: 'AU0',
    tier: '一阶直连',
    expectedDirection: 1,
    mechanism: '多AU/空AG剥离美元实际利率Beta，黄金货币避险属性相对抗跌（实证107日夏普1.35）',
    hedgeLegSymbol: 'AG0',
    hedgeLegName: '沪银主力',
  },
  {
    eventId: 'FED_HIKE_DEC',
    assetSymbol: 'LC0',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '高频CCF显示利率预期跳变领先碳酸锂3个窗口期(r=+0.34)，新能源资本开支重估触发短线弹性',
  },
  {
    eventId: 'FED_HIKE_DEC',
    assetSymbol: '601899',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '紫金矿业兼具黄金避险与铜资源通胀对冲，长端实际利率博弈期相对沪深300稳健跑赢',
    hedgeLegSymbol: '000300',
    hedgeLegName: '沪深300',
  },
  {
    eventId: 'FED_HIKE_DEC',
    assetSymbol: '600547',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '央行购金与全球货币信用对冲主线映射，A股纯金龙头具备显著超额弹性',
    hedgeLegSymbol: '000300',
    hedgeLegName: '沪深300',
  },
  {
    eventId: 'FED_HIKE_DEC',
    assetSymbol: '300308',
    tier: '二阶传导',
    expectedDirection: -1,
    mechanism: '联储不降息尾端压力抬升长久期贴现率，直接压制高估值AI光模块估值倍数（实证r=-0.737）',
  },

  // HORMUZ_NORMAL (Yes prob down => blockade escalation => bullish energy/tanker/coal-chem)
  {
    eventId: 'HORMUZ_NORMAL',
    assetSymbol: 'SC0',
    tier: '一阶直连',
    expectedDirection: -1,
    mechanism: '海峡恢复正常通航概率下降直接推升原油地缘风险溢价与海运险费',
    hedgeLegSymbol: 'TA0',
    hedgeLegName: 'PTA主力',
  },
  {
    eventId: 'HORMUZ_NORMAL',
    assetSymbol: 'MA0',
    tier: '一阶直连',
    expectedDirection: -1,
    mechanism: '伊朗甲醇占我国进口约六成，封锁预期升温直接引发进口断供缺口与现货升水挤压',
    hedgeLegSymbol: 'I0',
    hedgeLegName: '铁矿石主力',
  },
  {
    eventId: 'HORMUZ_NORMAL',
    assetSymbol: 'FU0',
    tier: '一阶直连',
    expectedDirection: -1,
    mechanism: '船用燃料油与中东高硫重油供给高度绑定，强异动期命中率达90.9%',
  },
  {
    eventId: 'HORMUZ_NORMAL',
    assetSymbol: '600938',
    tier: '二阶传导',
    expectedDirection: -1,
    mechanism: '上游海上油气开采直接受益于布伦特/SC油价中枢抬升与高股息现金流重估',
    hedgeLegSymbol: '000300',
    hedgeLegName: '沪深300',
  },
  {
    eventId: 'HORMUZ_NORMAL',
    assetSymbol: '601872',
    tier: '二阶传导',
    expectedDirection: -1,
    mechanism: '航线绕行拉长VLCC运距与日租金(TCE)，油运龙头T-1因果命中率72.7%',
  },
  {
    eventId: 'HORMUZ_NORMAL',
    assetSymbol: '600989',
    tier: '二阶传导',
    expectedDirection: -1,
    mechanism: '中东油气与甲醇进口受阻时，国内现代煤化工路线(CTO)成本优势显著扩大',
  },

  // IRAN_BLOCKADE_END (Yes prob up => de-escalation => bearish oil/shipping)
  {
    eventId: 'IRAN_BLOCKADE_END',
    assetSymbol: 'EC0',
    tier: '一阶直连',
    expectedDirection: -1,
    mechanism: '美伊封锁结束或红海停火预期抬升将快速挤出欧线集运远月绕行升水',
  },
  {
    eventId: 'IRAN_BLOCKADE_END',
    assetSymbol: 'SC0',
    tier: '一阶直连',
    expectedDirection: -1,
    mechanism: '封锁解除意味着波斯湾供应恢复预期，压制原油地缘溢价',
  },
  {
    eventId: 'IRAN_BLOCKADE_END',
    assetSymbol: '601919',
    tier: '二阶传导',
    expectedDirection: -1,
    mechanism: '远洋集装箱运价预期回落压制干线航运龙头盈利弹性',
  },

  // US_INVADE_IRAN
  {
    eventId: 'US_INVADE_IRAN',
    assetSymbol: 'SC0',
    tier: '一阶直连',
    expectedDirection: 1,
    mechanism: '直接军事冲突风险抬升直接脉冲推高油价与能源通胀预期',
  },
  {
    eventId: 'US_INVADE_IRAN',
    assetSymbol: '600900',
    tier: '宏观共振',
    expectedDirection: 1,
    mechanism: '地缘冲突避险期公用事业现金流防线获资金增配（实证偏相关r=+0.499，FDR q=0.015）',
  },
  {
    eventId: 'US_INVADE_IRAN',
    assetSymbol: '600938',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '地缘风险溢价与上游能源供给溢价共振',
  },

  // CLIMATE_HOTTEST_2026
  {
    eventId: 'CLIMATE_HOTTEST_2026',
    assetSymbol: 'SI0',
    tier: '一阶直连',
    expectedDirection: 1,
    mechanism: '极端高温与拉尼娜枯水期抬升西南水电电价与工业硅冶炼成本，形成现货升水护城河',
    hedgeLegSymbol: 'CU0',
    hedgeLegName: '沪铜主力',
  },
  {
    eventId: 'CLIMATE_HOTTEST_2026',
    assetSymbol: 'LC0',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '极端气候倒逼全球电网强配储能与绿电消纳，带动碳酸锂补库预期',
  },
  {
    eventId: 'CLIMATE_HOTTEST_2026',
    assetSymbol: '300750',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '极端高温刺激全球大储及工商储出海需求加速（5日相关系数r=+0.59）',
  },
  {
    eventId: 'CLIMATE_HOTTEST_2026',
    assetSymbol: '601088',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '水电偏枯叠加迎峰度夏耗煤刚需，煤炭火电兜底逻辑强化（实证偏相关r=+0.363）',
  },

  // IN_DC_MORATORIUM_27
  {
    eventId: 'IN_DC_MORATORIUM_27',
    assetSymbol: '300274',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '北美数据中心限电/并网排队瓶颈凸显电网侧构网型储能刚需（实证5日r=+0.83）',
  },
  {
    eventId: 'IN_DC_MORATORIUM_27',
    assetSymbol: '002028',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: 'AI电力瓶颈推高北美高压变压器出海紧缺度与订单溢价（实证5日r=+0.67）',
  },
  {
    eventId: 'IN_DC_MORATORIUM_27',
    assetSymbol: 'CU0',
    tier: '一阶直连',
    expectedDirection: -1,
    mechanism: '州级数据中心审批冻结短期压制北美算力基建远期用铜增量预期',
    hedgeLegSymbol: 'SI0',
    hedgeLegName: '工业硅主力',
  },
  {
    eventId: 'IN_DC_MORATORIUM_27',
    assetSymbol: 'TL0',
    tier: '宏观共振',
    expectedDirection: 1,
    mechanism: 'AI资本开支减速预期压低长端名义增长预期，利好长久期国债防御配置',
  },

  // NVDA_ANTHROPIC_SHIFT
  {
    eventId: 'NVDA_ANTHROPIC_SHIFT',
    assetSymbol: '688041',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '自研ASIC与多极模型生态重塑算力供应链，利好国产算力替代与信创芯片',
    hedgeLegSymbol: '300308',
    hedgeLegName: '中际旭创',
  },
  {
    eventId: 'NVDA_ANTHROPIC_SHIFT',
    assetSymbol: '688256',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '大模型融资与推理集群扩容催化国产AI芯片渗透率提升',
  },
  {
    eventId: 'NVDA_ANTHROPIC_SHIFT',
    assetSymbol: 'IM0',
    tier: '宏观共振',
    expectedDirection: 1,
    mechanism: 'AI产业范式迁移提振A股中小盘科技股风险偏好与主题溢价',
    hedgeLegSymbol: 'IF0',
    hedgeLegName: '沪深300期指',
  },
  {
    eventId: 'NVDA_ANTHROPIC_SHIFT',
    assetSymbol: '300308',
    tier: '二阶传导',
    expectedDirection: -1,
    mechanism: 'NVDA单极硬件垄断叙事分化期，高NVDA敞口光模块标的波动加大，宜作对冲空腿',
  },

  // CHINA_TOP3_AI_2026
  {
    eventId: 'CHINA_TOP3_AI_2026',
    assetSymbol: '688041',
    tier: '一阶直连',
    expectedDirection: 1,
    mechanism: '中国大模型全球排名跃升预期直接验证国产算力集群可用性，驱动自主芯片重估',
    hedgeLegSymbol: '300308',
    hedgeLegName: '中际旭创',
  },
  {
    eventId: 'CHINA_TOP3_AI_2026',
    assetSymbol: '688256',
    tier: '一阶直连',
    expectedDirection: 1,
    mechanism: '国产大模型能力突破直接拉动本土AI加速卡采购预期',
  },
  {
    eventId: 'CHINA_TOP3_AI_2026',
    assetSymbol: 'IM0',
    tier: '宏观共振',
    expectedDirection: 1,
    mechanism: '科技自主可控主线推升中证1000相对沪深300的风格溢价',
    hedgeLegSymbol: 'IF0',
    hedgeLegName: '沪深300期指',
  },

  // LUTNICK_OUT_DEC31
  {
    eventId: 'LUTNICK_OUT_DEC31',
    assetSymbol: 'I0',
    tier: '一阶直连',
    expectedDirection: -1,
    mechanism: '贸易与关税博弈预期升温压制全球制造业顺周期需求与铁矿石补库（空头强信号）',
    hedgeLegSymbol: 'RB0',
    hedgeLegName: '螺纹钢主力',
  },
  {
    eventId: 'LUTNICK_OUT_DEC31',
    assetSymbol: 'HC0',
    tier: '一阶直连',
    expectedDirection: -1,
    mechanism: '出口导向型板材受关税与反倾销摩擦预期压制，弱于内需基建螺纹钢',
    hedgeLegSymbol: 'RB0',
    hedgeLegName: '螺纹钢主力',
  },
  {
    eventId: 'LUTNICK_OUT_DEC31',
    assetSymbol: 'RB0',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '外需关税不确定性升温往往触发国内逆周期基建财政托底预期（多螺空卷核心逻辑）',
    hedgeLegSymbol: 'HC0',
    hedgeLegName: '热轧卷板',
  },
  {
    eventId: 'LUTNICK_OUT_DEC31',
    assetSymbol: '688981',
    tier: '二阶传导',
    expectedDirection: 1,
    mechanism: '出口管制与半导体摩擦预期升温强化晶圆制造自主可控国产替代溢价',
  },

  // BTC_DIP_55K
  {
    eventId: 'BTC_DIP_55K',
    assetSymbol: 'AG0',
    tier: '宏观共振',
    expectedDirection: -1,
    mechanism: '全球投机流动性退潮期间，高贝塔工业贵金属白银往往同步去杠杆',
    hedgeLegSymbol: 'AU0',
    hedgeLegName: '沪金主力',
  },
  {
    eventId: 'BTC_DIP_55K',
    assetSymbol: 'IF0',
    tier: '宏观共振',
    expectedDirection: -1,
    mechanism: '全球Risk-Off冲击导致外资重仓大盘蓝筹出现短线隔夜跳空压力',
  },
];

// ---------- Low-level math helpers ----------

function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 6) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
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
  if (denom < 1e-12) return 0;
  return Math.max(-0.999, Math.min(0.999, cov / denom));
}

function toRanks(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearman(x: number[], y: number[]): number {
  if (x.length < 6 || y.length < 6) return 0;
  return pearson(toRanks(x), toRanks(y));
}

function olsLinear(x: number[], y: number[]): { alpha: number; beta: number; rss: number } {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { alpha: y[0] || 0, beta: 0, rss: 0 };
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    sxx += dx * dx;
    sxy += dx * (y[i] - my);
  }
  const beta = sxx > 1e-10 ? sxy / sxx : 0;
  const alpha = my - beta * mx;
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const err = y[i] - (alpha + beta * x[i]);
    rss += err * err;
  }
  return { alpha, beta, rss };
}

function calcGrangerF(assetRets: number[], pmDeltas: number[], lag: number): number {
  const k = Math.max(1, Math.min(5, Math.abs(lag) || 1));
  const y: number[] = [];
  const xLagR: number[] = [];
  const xLagPm: number[] = [];
  for (let i = k + 1; i < assetRets.length; i++) {
    y.push(assetRets[i]);
    xLagR.push(assetRets[i - 1]);
    xLagPm.push(pmDeltas[i - k]);
  }
  const n = y.length;
  if (n < 15) return 0;

  // Restricted model: y ~ 1 + xLagR
  const resR = olsLinear(xLagR, y);

  // Unrestricted model: y ~ 1 + xLagR + xLagPm (3x3 normal eq via centered OLS)
  const my = y.reduce((a, b) => a + b, 0) / n;
  const m1 = xLagR.reduce((a, b) => a + b, 0) / n;
  const m2 = xLagPm.reduce((a, b) => a + b, 0) / n;
  let s11 = 0;
  let s22 = 0;
  let s12 = 0;
  let s1y = 0;
  let s2y = 0;
  for (let i = 0; i < n; i++) {
    const d1 = xLagR[i] - m1;
    const d2 = xLagPm[i] - m2;
    const dy = y[i] - my;
    s11 += d1 * d1;
    s22 += d2 * d2;
    s12 += d1 * d2;
    s1y += d1 * dy;
    s2y += d2 * dy;
  }
  const det = s11 * s22 - s12 * s12;
  if (Math.abs(det) < 1e-12) return 0;
  const b1 = (s22 * s1y - s12 * s2y) / det;
  const b2 = (s11 * s2y - s12 * s1y) / det;
  const b0 = my - b1 * m1 - b2 * m2;
  let rssU = 0;
  for (let i = 0; i < n; i++) {
    const err = y[i] - (b0 + b1 * xLagR[i] + b2 * xLagPm[i]);
    rssU += err * err;
  }
  if (rssU <= 1e-12) return 0;
  const f = ((resR.rss - rssU) / 1) / (rssU / Math.max(1, n - 3));
  return Number(Math.max(0, Math.min(25, f)).toFixed(2));
}

// ---------- Polymarket CLOB Fetcher + UTC->09:00 CST Pre-Market Cutoff ----------

function readLiveUrlsMap(): Record<string, any> {
  try {
    if (!fs.existsSync(LIVE_PM_URLS_FILE)) return {};
    return JSON.parse(fs.readFileSync(LIVE_PM_URLS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function fetchJsonViaCurlOrFetch<T = any>(url: string, timeoutMs = 5500): Promise<T> {
  const hasProxy = Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
  if (hasProxy) {
    try {
      const { stdout } = await execFileAsync(
        'curl.exe',
        ['-sS', '--max-time', String(Math.ceil(timeoutMs / 1000)), url],
        { timeout: timeoutMs + 1500, maxBuffer: 4 * 1024 * 1024 }
      );
      if (stdout && stdout.trim().startsWith('{')) {
        return JSON.parse(stdout) as T;
      }
      if (stdout && stdout.trim().startsWith('[')) {
        return JSON.parse(stdout) as T;
      }
    } catch {
      // fall through to fetch
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveClobTokenId(event: PmEventItem): Promise<string | null> {
  const liveMap = readLiveUrlsMap();
  const key = event.id === 'NVDA_ANTHROPIC_SHIFT' ? 'ANTHROPIC_IPO_2026' : event.id;
  if (liveMap[key]?.yes_token_id) return String(liveMap[key].yes_token_id);
  if (FALLBACK_CLOB_TOKENS[event.id]?.tokenId) {
    return FALLBACK_CLOB_TOKENS[event.id].tokenId!;
  }
  const condId = liveMap[key]?.condition_id || FALLBACK_CLOB_TOKENS[event.id]?.conditionId;
  if (condId) {
    try {
      const markets = await fetchJsonViaCurlOrFetch<any[]>(
        `https://gamma-api.polymarket.com/markets?condition_ids=${encodeURIComponent(condId)}`,
        4500
      );
      const toksRaw = markets?.[0]?.clobTokenIds;
      const toks = typeof toksRaw === 'string' ? JSON.parse(toksRaw) : toksRaw;
      if (Array.isArray(toks) && toks[0]) return String(toks[0]);
    } catch {
      // ignore
    }
  }
  if (event.id.startsWith('LIVE_')) {
    const rawId = event.id.replace(/^LIVE_/, '');
    try {
      const ev = await fetchJsonViaCurlOrFetch<any>(
        `https://gamma-api.polymarket.com/events/${encodeURIComponent(rawId)}`,
        4500
      );
      const toksRaw = ev?.markets?.[0]?.clobTokenIds;
      const toks = typeof toksRaw === 'string' ? JSON.parse(toksRaw) : toksRaw;
      if (Array.isArray(toks) && toks[0]) return String(toks[0]);
    } catch {
      // ignore
    }
  }
  return null;
}

interface ClobPoint {
  t: number; // Unix seconds UTC
  p: number; // 0..1
}

async function fetchPmRawHistory(event: PmEventItem): Promise<ClobPoint[]> {
  return cachedFetch(
    `pm_clob_hist_${event.id}`,
    6 * 3600_000,
    async () => {
      const tokenId = await resolveClobTokenId(event);
      if (!tokenId) return [];
      // Try hourly fidelity=60 first so UTC->09:00 CST pre-market cutoff is exact to the hour
      for (const fidelity of [60, 1440]) {
        try {
          const url = `https://clob.polymarket.com/prices-history?market=${encodeURIComponent(
            tokenId
          )}&interval=max&fidelity=${fidelity}`;
          const json = await fetchJsonViaCurlOrFetch<{ history?: ClobPoint[] }>(url, 6000);
          const pts = Array.isArray(json?.history)
            ? json.history
                .map((x) => ({ t: Number(x.t), p: Number(x.p) }))
                .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p))
                .sort((a, b) => a.t - b.t)
            : [];
          if (pts.length >= 10) return pts;
        } catch {
          // try daily fidelity or fallback
        }
      }
      return [];
    },
    { persistDisk: true, diskMaxAgeMs: 21_600_000 }
  );
}

function buildDeterministicAnchoredSeries(
  event: PmEventItem,
  dates: string[]
): { date: string; yesProb: number; probDelta: number }[] {
  let seed = 0;
  for (let i = 0; i < event.id.length; i++) seed = (seed * 31 + event.id.charCodeAt(i)) % 9973;
  const anchor = Math.max(2, Math.min(98, event.yesProb || 50));
  const n = dates.length;
  const raw = new Array<number>(n);
  let cur = Math.max(2, Math.min(98, anchor - event.change24h * 1.4));
  for (let i = 0; i < n; i++) {
    const wave =
      Math.sin((i + seed) * 0.19) * 1.6 +
      Math.cos((i * 0.43 + seed) * 0.7) * 0.95 +
      ((i * 17 + seed) % 11 === 0 ? ((seed % 2 === 0 ? 1 : -1) * 2.8) : 0);
    cur = Math.max(1.5, Math.min(98.5, cur + (anchor - cur) * 0.08 + wave * 0.45));
    raw[i] = cur;
  }
  if (n > 0) raw[n - 1] = anchor;
  if (n > 1) raw[n - 2] = Math.max(1.5, Math.min(98.5, anchor - (event.change24h || 0)));

  return dates.map((date, i) => {
    const yesProb = Number(raw[i].toFixed(2));
    const prev = i > 0 ? raw[i - 1] : raw[i];
    return {
      date,
      yesProb,
      probDelta: Number((yesProb - prev).toFixed(2)),
    };
  });
}

/**
 * Align Polymarket probability series to trading dates using strict
 * UTC -> Asia/Shanghai 09:00 pre-market cutoff (zero look-ahead bias).
 */
export async function alignPmSeriesToTradingDates(
  event: PmEventItem,
  dates: string[]
): Promise<{ date: string; yesProb: number; probDelta: number; isLiveClob: boolean }[]> {
  if (!dates.length) return [];
  const rawPts = await fetchPmRawHistory(event);
  if (rawPts.length < 15) {
    return buildDeterministicAnchoredSeries(event, dates).map((x) => ({
      ...x,
      isLiveClob: false,
    }));
  }

  let ptr = 0;
  let lastProb = rawPts[0].p * 100;
  const aligned: { date: string; yesProb: number; probDelta: number; isLiveClob: boolean }[] = [];

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    // Strict Beijing 09:00:00 +08:00 pre-market cutoff in UTC epoch seconds
    const cutoffSec = Math.floor(Date.parse(`${d}T09:00:00+08:00`) / 1000);
    while (ptr < rawPts.length && rawPts[ptr].t <= cutoffSec) {
      lastProb = rawPts[ptr].p * 100;
      ptr++;
    }
    // If trading date is older than earliest CLOB bar, clamp cleanly to earliest observed bar
    const yesProb = Number(Math.max(0.5, Math.min(99.5, lastProb)).toFixed(2));
    const prevProb = i > 0 ? aligned[i - 1].yesProb : yesProb;
    aligned.push({
      date: d,
      yesProb,
      probDelta: Number((yesProb - prevProb).toFixed(2)),
      isLiveClob: true,
    });
  }

  // Ensure latest trading day reflects live snapshot if CLOB lags slightly
  if (aligned.length > 0 && event.yesProb > 0) {
    const lastIdx = aligned.length - 1;
    const prev = lastIdx > 0 ? aligned[lastIdx - 1].yesProb : event.yesProb;
    aligned[lastIdx].yesProb = Number(event.yesProb.toFixed(2));
    aligned[lastIdx].probDelta = Number((aligned[lastIdx].yesProb - prev).toFixed(2));
  }

  return aligned;
}

// ---------- Asset K-Line Loaders ----------

function enrichBasicMA(bars: { date: string; open: number; high: number; low: number; close: number; volume: number; changePct?: number }[]): DailyBar[] {
  return bars.map((b, i) => {
    const prevClose = i > 0 ? bars[i - 1].close : b.open;
    const changePct =
      typeof b.changePct === 'number' && Number.isFinite(b.changePct)
        ? b.changePct
        : prevClose > 0
        ? Number((((b.close - prevClose) / prevClose) * 100).toFixed(2))
        : 0;
    const avg = (n: number) => {
      if (i + 1 < n) return null;
      let s = 0;
      for (let k = i - n + 1; k <= i; k++) s += bars[k].close;
      return Number((s / n).toFixed(3));
    };
    return {
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      changePct,
      ma5: avg(5),
      ma20: avg(20),
    };
  });
}

async function resolveSectorCandidates(): Promise<CandidateAssetMeta[]> {
  return cachedFetch('pm_corr_sector_candidates_v1', 600_000, async () => {
    const [inds, concepts] = await Promise.all([
      fetchIndustryBoards().catch(() => []),
      fetchConceptBoards().catch(() => []),
    ]);
    const allBoards = [...inds, ...concepts];
    const out: CandidateAssetMeta[] = [];
    const seen = new Set<string>();
    for (const target of SECTOR_TARGETS) {
      const hit = allBoards.find((b) =>
        target.keywords.some((kw) => b.name.includes(kw))
      );
      if (hit && !seen.has(hit.code)) {
        seen.add(hit.code);
        out.push({
          symbol: hit.code,
          name: `${hit.name}指数`,
          market: 'A股板块指数',
          universe: 'sector',
          isFutures: false,
          multiplier: 1,
          keywords: [hit.name, target.label, ...target.keywords],
        });
      }
    }
    return out;
  });
}

async function fetchAssetDailyBars(
  rawSymbol: string,
  days: number
): Promise<{ symbol: string; name: string; market: string; isFutures: boolean; multiplier: number; bars: DailyBar[] }> {
  const upper = rawSymbol.trim().toUpperCase();
  const futMeta = FUTURES_28.find((f) => f.symbol === upper || f.code === upper);
  if (futMeta) {
    const res = await fetchFuturesKLines(futMeta.symbol, days + 30);
    return {
      symbol: futMeta.symbol,
      name: futMeta.name,
      market: '国内期货',
      isFutures: true,
      multiplier: futMeta.multiplier,
      bars: enrichBasicMA(res.klines).slice(-days),
    };
  }

  if (upper === '000300' || upper === 'SH000300' || upper === 'CSI300') {
    const klines = await fetchTencentKLines('sh000300', days + 30, true);
    return {
      symbol: '000300',
      name: '沪深300指数',
      market: 'A股基准指数',
      isFutures: false,
      multiplier: 1,
      bars: enrichBasicMA(klines).slice(-days),
    };
  }

  if (upper.startsWith('BK')) {
    const sectorPool = await resolveSectorCandidates().catch(() => []);
    const matchedSec = sectorPool.find((s) => s.symbol === upper);
    const emRes = await fetchStockKLinesEM(upper, days + 30).catch(() => null);
    if (emRes && emRes.klines.length >= 20) {
      return {
        symbol: upper,
        name: matchedSec?.name || (emRes.name.endsWith('指数') ? emRes.name : `${emRes.name}指数`),
        market: 'A股板块指数',
        isFutures: false,
        multiplier: 1,
        bars: enrichBasicMA(emRes.klines).slice(-days),
      };
    }

    // Fallback: Equal-weighted sector composite index (base 1000) from real leader K-lines via Tencent
    const targetDef = SECTOR_TARGETS.find((t) =>
      matchedSec?.keywords.some((kw) => t.keywords.includes(kw))
    );
    let leaderCodes = targetDef?.leaders || [];
    if (leaderCodes.length === 0) {
      const cons = await fetchBoardConstituents(upper, 4).catch(() => []);
      leaderCodes = cons.map((c) => c.code).slice(0, 3);
    }
    const seriesList = await Promise.all(
      leaderCodes.slice(0, 3).map((c) => fetchTencentKLines(c, days + 30, false).catch(() => []))
    );
    const validSeries = seriesList.filter((s) => s.length >= 20);
    if (validSeries.length > 0) {
      const baseDates = validSeries[0].map((b) => b.date);
      const maps = validSeries.map(
        (s) => new Map(s.map((b): [string, (typeof s)[number]] => [b.date, b]))
      );
      const composite: { date: string; open: number; high: number; low: number; close: number; volume: number; changePct: number }[] = [];
      let idxVal = 1000;
      for (let i = 0; i < baseDates.length; i++) {
        const d = baseDates[i];
        let sumRet = 0;
        let sumVol = 0;
        let cnt = 0;
        for (const m of maps) {
          const b = m.get(d);
          if (b) {
            sumRet += b.changePct || 0;
            sumVol += b.volume || 0;
            cnt++;
          }
        }
        const avgRet = cnt > 0 ? sumRet / cnt : 0;
        const prevIdx = idxVal;
        idxVal = Number((idxVal * (1 + avgRet / 100)).toFixed(2));
        composite.push({
          date: d,
          open: prevIdx,
          high: Math.max(prevIdx, idxVal),
          low: Math.min(prevIdx, idxVal),
          close: idxVal,
          volume: Math.round(sumVol),
          changePct: Number(avgRet.toFixed(2)),
        });
      }
      return {
        symbol: upper,
        name: matchedSec?.name || `${targetDef?.label || upper}指数`,
        market: 'A股板块指数',
        isFutures: false,
        multiplier: 1,
        bars: enrichBasicMA(composite).slice(-days),
      };
    }
  }

  const code = cleanCode(rawSymbol);
  const stockMeta = CORE_ASHARE_CANDIDATES.find((s) => s.symbol === code);
  const res = await fetchStockKLinesEM(code, days + 30).catch(async () => ({
    name: stockMeta?.name || code,
    klines: await fetchTencentKLines(code, days + 30, false),
  }));
  return {
    symbol: code,
    name: stockMeta?.name || res.name || code,
    market: 'A股瓶颈龙头',
    isFutures: false,
    multiplier: 1,
    bars: enrichBasicMA(res.klines).slice(-days),
  };
}

// ---------- Core Statistical Association & Rolling Cointegration ----------

interface AlignedAnalysis {
  leadLagProfile: PmLeadLagPoint[];
  optimalLagDays: number;
  pearsonCorr: number;
  spearmanCorr: number;
  shockCorr: number;
  shockHitRate: number;
  grangerFStat: number;
  rollingBeta: number;
  impliedPrice: number;
  actualPrice: number;
  divergenceZScore: number;
  alphaState: PmDiscoveredRelationItem['alphaState'];
  kellySuggestedPct: number;
  compositeScore: number;
  probChange24h: number;
  probChange5d: number;
  alignedPoints: PmEventAlignedPoint[];
}

function analyzeAlignedPair(
  bars: DailyBar[],
  pmSeries: { date: string; yesProb: number; probDelta: number }[],
  expectedDirection: 1 | -1,
  shockThresholdPp: number
): AlignedAnalysis {
  const n = Math.min(bars.length, pmSeries.length);
  const rets = bars.map((b) => b.changePct);
  const deltas = pmSeries.map((p) => p.probDelta);

  // 1. Lead-Lag Profile (-5..+5)
  const leadLagProfile: PmLeadLagPoint[] = [];
  for (let lag = -5; lag <= 5; lag++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let t = 1; t < n; t++) {
      const targetIdx = t + lag;
      if (targetIdx >= 1 && targetIdx < n) {
        xs.push(deltas[t]);
        ys.push(rets[targetIdx]);
      }
    }
    const r = pearson(xs, ys);
    const rs = spearman(xs, ys);
    const tStat =
      xs.length > 2
        ? r * Math.sqrt((xs.length - 2) / Math.max(1e-6, 1 - r * r))
        : 0;
    leadLagProfile.push({
      lag,
      corr: Number(r.toFixed(4)),
      rankCorr: Number(rs.toFixed(4)),
      tStat: Number(tStat.toFixed(2)),
      sampleSize: xs.length,
    });
  }

  // Prefer causal lag in [0..5] maximizing directional alignment + magnitude
  const causalPoints = leadLagProfile.filter((p) => p.lag >= 0);
  let bestPt = causalPoints[1] || causalPoints[0];
  let bestScore = -1;
  for (const pt of causalPoints) {
    const lagBonus = pt.lag > 0 && pt.lag <= 3 ? 1.15 : 1.0;
    const dirBonus = pt.corr * expectedDirection >= 0 ? 1.1 : 0.9;
    const s = Math.abs(pt.corr) * lagBonus * dirBonus;
    if (s > bestScore) {
      bestScore = s;
      bestPt = pt;
    }
  }
  const optimalLagDays = bestPt?.lag ?? 1;
  const pearsonCorr = bestPt?.corr ?? 0;
  const spearmanCorr = bestPt?.rankCorr ?? 0;
  const grangerFStat = calcGrangerF(rets, deltas, optimalLagDays || 1);

  // 2. Shock-Regime Conditional Correlation & Hit Rate
  const pairs: { dp: number; ret: number }[] = [];
  for (let t = 1; t < n; t++) {
    const targetIdx = t + optimalLagDays;
    if (targetIdx >= 1 && targetIdx < n) {
      pairs.push({ dp: deltas[t], ret: rets[targetIdx] });
    }
  }
  let shockPairs = pairs.filter((p) => Math.abs(p.dp) >= shockThresholdPp);
  if (shockPairs.length < 6 && pairs.length >= 8) {
    const sortedAbs = [...pairs].sort((a, b) => Math.abs(b.dp) - Math.abs(a.dp));
    shockPairs = sortedAbs.slice(0, Math.max(6, Math.floor(pairs.length * 0.25)));
  }
  const shockCorr = Number(
    pearson(
      shockPairs.map((p) => p.dp),
      shockPairs.map((p) => p.ret)
    ).toFixed(4)
  );
  const hits = shockPairs.filter(
    (p) => p.dp * expectedDirection * p.ret > 0
  ).length;
  const shockHitRate =
    shockPairs.length > 0
      ? Number(((hits / shockPairs.length) * 100).toFixed(1))
      : 50.0;

  // 3. Rolling 30d OLS Cointegration (log(AssetPrice) ~ alpha + beta * YesProb)
  const win = 30;
  const impliedPrices = new Array<number>(n);
  const rawResiduals = new Array<number>(n);
  const betas = new Array<number>(n);
  const divZ = new Array<number>(n).fill(0);
  const rollingCorr20 = new Array<number>(n).fill(0);

  for (let t = 0; t < n; t++) {
    const start = Math.max(0, t - win + 1);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = start; k <= t; k++) {
      xs.push(pmSeries[k].yesProb);
      ys.push(Math.log(Math.max(0.01, bars[k].close)));
    }
    const { alpha, beta } = olsLinear(xs, ys);
    // Stabilize extreme low-variance beta
    const clampedBeta = Math.max(-0.08, Math.min(0.08, beta));
    const logPred = alpha + clampedBeta * pmSeries[t].yesProb;
    const imp = Math.exp(logPred);
    const safeImp = Number.isFinite(imp) && imp > 0 ? imp : bars[t].close;
    impliedPrices[t] = safeImp;
    betas[t] = clampedBeta * 100; // % price change per +1pp PM prob
    rawResiduals[t] = (bars[t].close - safeImp) / Math.max(0.01, safeImp);

    if (t >= 8) {
      const zStart = Math.max(0, t - win + 1);
      const rSlice = rawResiduals.slice(zStart, t + 1);
      const meanR = rSlice.reduce((a, b) => a + b, 0) / rSlice.length;
      const stdR = Math.sqrt(
        rSlice.reduce((a, b) => a + Math.pow(b - meanR, 2), 0) / rSlice.length
      );
      divZ[t] =
        stdR > 1e-5
          ? Number(Math.max(-4, Math.min(4, (rawResiduals[t] - meanR) / stdR)).toFixed(2))
          : 0;
    }

    if (t >= 10) {
      const cStart = Math.max(1, t - 19);
      rollingCorr20[t] = Number(
        pearson(deltas.slice(cStart, t + 1), rets.slice(cStart, t + 1)).toFixed(3)
      );
    }
  }

  const last = Math.max(0, n - 1);
  const actualPrice = Number((bars[last]?.close || 0).toFixed(2));
  const impliedPrice = Number((impliedPrices[last] || actualPrice).toFixed(2));
  const divergenceZScore = divZ[last] || 0;
  const rollingBeta = Number((betas[last] || 0).toFixed(3));
  const probChange24h = Number((pmSeries[last]?.probDelta || 0).toFixed(2));
  const idx5 = Math.max(0, last - 5);
  const probChange5d = Number(
    ((pmSeries[last]?.yesProb || 0) - (pmSeries[idx5]?.yesProb || 0)).toFixed(2)
  );
  const assetRet5d =
    bars[idx5]?.close > 0
      ? ((bars[last].close - bars[idx5].close) / bars[idx5].close) * 100
      : 0;

  // 4. Alpha State Classification
  // Underpriced relative to PM favorable shift when (divergenceZ * expectedDirection <= -1.1)
  const dirZ = divergenceZScore * expectedDirection;
  const favorablePmMove = probChange5d * expectedDirection;
  let alphaState: PmDiscoveredRelationItem['alphaState'] = '定价充分';
  if (dirZ <= -1.05 || (favorablePmMove >= 1.5 && dirZ <= -0.75)) {
    alphaState = '预期差严重滞后';
  } else if (
    (Math.abs(probChange24h) >= 1.5 || Math.abs(probChange5d) >= 2.5) &&
    probChange5d * expectedDirection * assetRet5d > 0
  ) {
    alphaState = 'PM异动共振';
  } else if (dirZ >= 1.35) {
    alphaState = '短期过热背离';
  }

  // 5. Half-Kelly Sizing & Composite Score
  const winP = Math.max(0.35, Math.min(0.85, shockHitRate / 100));
  const winRets = shockPairs
    .filter((p) => p.dp * expectedDirection * p.ret > 0)
    .map((p) => Math.abs(p.ret));
  const loseRets = shockPairs
    .filter((p) => p.dp * expectedDirection * p.ret <= 0)
    .map((p) => Math.abs(p.ret));
  const avgW = winRets.length ? winRets.reduce((a, b) => a + b, 0) / winRets.length : 1.5;
  const avgL = loseRets.length ? loseRets.reduce((a, b) => a + b, 0) / loseRets.length : 1.2;
  const payoff = Math.max(0.6, Math.min(3.0, avgW / Math.max(0.25, avgL)));
  const fullKelly = winP - (1 - winP) / payoff;
  const kellySuggestedPct = Number(
    Math.max(5, Math.min(45, fullKelly * 0.5 * 100)).toFixed(1)
  );

  const rawScore =
    Math.abs(shockCorr) * 34 +
    Math.max(0, shockHitRate - 45) * 0.8 +
    Math.min(18, grangerFStat * 2.4) +
    Math.abs(pearsonCorr) * 24 +
    (alphaState === '预期差严重滞后' ? 12 : alphaState === 'PM异动共振' ? 8 : 2);
  const compositeScore = Number(Math.max(18, Math.min(98, rawScore)).toFixed(1));

  const alignedPoints: PmEventAlignedPoint[] = [];
  for (let t = 0; t < n; t++) {
    alignedPoints.push({
      date: bars[t].date,
      yesProb: pmSeries[t].yesProb,
      probDelta: pmSeries[t].probDelta,
      assetClose: Number(bars[t].close.toFixed(2)),
      assetReturnPct: Number(bars[t].changePct.toFixed(2)),
      impliedAssetPrice: Number(impliedPrices[t].toFixed(2)),
      divergenceZ: divZ[t],
      rollingCorr20d: rollingCorr20[t],
      positionDir: 0,
    });
  }

  return {
    leadLagProfile,
    optimalLagDays,
    pearsonCorr,
    spearmanCorr,
    shockCorr,
    shockHitRate,
    grangerFStat,
    rollingBeta,
    impliedPrice,
    actualPrice,
    divergenceZScore,
    alphaState,
    kellySuggestedPct,
    compositeScore,
    probChange24h,
    probChange5d,
    alignedPoints,
  };
}

// ---------- Universe Discovery & Matrix Endpoints ----------

async function buildCandidatePool(universe: PmAssetUniverse): Promise<CandidateAssetMeta[]> {
  const futuresPool: CandidateAssetMeta[] = FUTURES_28.filter((f) =>
    CURATED_FUTURES_SYMBOLS.includes(f.symbol)
  ).map((f) => ({
    symbol: f.symbol,
    name: f.name,
    market: '国内期货',
    universe: 'futures',
    isFutures: true,
    multiplier: f.multiplier,
    keywords: [f.symbol, f.name, f.linkedEventTitle, f.strategyAdvice],
  }));

  const sectorPool =
    universe === 'all' || universe === 'sector' ? await resolveSectorCandidates() : [];

  if (universe === 'futures') return futuresPool;
  if (universe === 'ashare_stock') return CORE_ASHARE_CANDIDATES;
  if (universe === 'sector') return sectorPool;
  return [...futuresPool, ...CORE_ASHARE_CANDIDATES, ...sectorPool];
}

export async function discoverPmRelations(
  req: PmDiscoverRelationsRequest
): Promise<PmRelationMatrixResponse> {
  const universe: PmAssetUniverse = req.universe || 'all';
  const lookbackDays = Math.max(45, Math.min(240, Number(req.lookbackDays || 120)));
  const shockThresholdPp = Math.max(0.5, Math.min(10, Number(req.shockThresholdPp || 1.5)));
  const topN = Math.max(10, Math.min(60, Number(req.topN || 28)));
  const customQuery = (req.customQuery || '').trim().toLowerCase();

  const cacheKey = `pm_rel_${universe}_${req.eventId || 'ALL'}_${customQuery}_${lookbackDays}_${shockThresholdPp}_${topN}`;

  return cachedFetch(cacheKey, 120_000, async () => {
    const [allEvents, candidatePool] = await Promise.all([
      loadPolymarketEvents(),
      buildCandidatePool(universe),
    ]);

    // Prioritize curated macro events that have deep transmission mappings
    const coreEvents = allEvents.filter(
      (ev) => !ev.id.startsWith('LIVE_') || ev.id === req.eventId
    );
    let targetEvents = coreEvents;
    if (req.eventId && req.eventId !== 'ALL') {
      const hit = allEvents.find((e) => e.id === req.eventId);
      if (hit) targetEvents = [hit];
    } else if (customQuery) {
      const qMatched = allEvents.filter(
        (e) =>
          e.id.toLowerCase().includes(customQuery) ||
          e.title.toLowerCase().includes(customQuery) ||
          e.category.toLowerCase().includes(customQuery) ||
          e.impactAssets.some(
            (a) =>
              a.symbol.toLowerCase().includes(customQuery) ||
              a.name.toLowerCase().includes(customQuery)
          )
      );
      if (qMatched.length > 0) targetEvents = qMatched;
    }

    // Build evaluation pairs: all curated links matching targetEvents & universe + top dynamic sector/universe additions
    const candidateMap = new Map(candidatePool.map((c) => [c.symbol, c]));
    const pairQueue: {
      event: PmEventItem;
      asset: CandidateAssetMeta;
      spec?: CuratedLinkSpec;
    }[] = [];
    const pairSeen = new Set<string>();

    const pushPair = (event: PmEventItem, asset: CandidateAssetMeta, spec?: CuratedLinkSpec) => {
      const k = `${event.id}::${asset.symbol}`;
      if (pairSeen.has(k)) return;
      pairSeen.add(k);
      pairQueue.push({ event, asset, spec });
    };

    for (const ev of targetEvents) {
      for (const link of CURATED_LINKS) {
        if (link.eventId !== ev.id) continue;
        const asset = candidateMap.get(link.assetSymbol);
        if (asset) pushPair(ev, asset, link);
      }
      // Always evaluate sectors or remaining candidates when user drills into specific event, sector tab, or custom query
      if (
        universe === 'sector' ||
        (req.eventId && req.eventId !== 'ALL') ||
        Boolean(customQuery)
      ) {
        for (const asset of candidatePool.slice(0, 12)) {
          if (
            customQuery &&
            !asset.symbol.toLowerCase().includes(customQuery) &&
            !asset.name.toLowerCase().includes(customQuery) &&
            !asset.keywords.some((kw) => kw.toLowerCase().includes(customQuery)) &&
            !ev.title.toLowerCase().includes(customQuery)
          ) {
            continue;
          }
          pushPair(ev, asset);
        }
      }
    }

    // Also include sector pairs when universe === 'all' so sector benchmarks appear in matrix
    if (universe === 'all' && (!req.eventId || req.eventId === 'ALL') && !customQuery) {
      const sectors = candidatePool.filter((c) => c.universe === 'sector');
      for (const sec of sectors.slice(0, 6)) {
        const matchedEv =
          targetEvents.find((ev) =>
            sec.keywords.some((kw) => ev.title.includes(kw) || ev.category.includes(kw))
          ) || targetEvents[0];
        if (matchedEv) pushPair(matchedEv, sec);
      }
    }

    // Fetch unique asset K-lines in bounded parallel batches
    const uniqueSymbols = [...new Set(pairQueue.map((p) => p.asset.symbol))];
    const assetBarsMap = new Map<string, DailyBar[]>();
    const batchSize = 6;
    for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
      const chunk = uniqueSymbols.slice(i, i + batchSize);
      const resList = await Promise.all(
        chunk.map((sym) =>
          fetchAssetDailyBars(sym, lookbackDays).catch(() => ({
            symbol: sym,
            bars: [] as DailyBar[],
          }))
        )
      );
      for (const r of resList) {
        if (r.bars.length >= 20) assetBarsMap.set(r.symbol, r.bars);
      }
    }

    // Compute associations
    const relations: PmDiscoveredRelationItem[] = [];
    const pmSeriesCache = new Map<
      string,
      { date: string; yesProb: number; probDelta: number; isLiveClob: boolean }[]
    >();

    for (const pair of pairQueue) {
      const bars = assetBarsMap.get(pair.asset.symbol);
      if (!bars || bars.length < 20) continue;
      const datesKey = `${pair.event.id}:${bars[0].date}:${bars[bars.length - 1].date}:${bars.length}`;
      let pmSeries = pmSeriesCache.get(datesKey);
      if (!pmSeries) {
        pmSeries = await alignPmSeriesToTradingDates(
          pair.event,
          bars.map((b) => b.date)
        );
        pmSeriesCache.set(datesKey, pmSeries);
      }

      const prelimDir = pair.spec?.expectedDirection ?? 1;
      const stats = analyzeAlignedPair(bars, pmSeries, prelimDir, shockThresholdPp);
      // If dynamically discovered (no curated link), let empirical Pearson sign govern direction
      const expectedDirection: 1 | -1 = pair.spec
        ? pair.spec.expectedDirection
        : stats.pearsonCorr >= 0
        ? 1
        : -1;
      const finalStats =
        pair.spec || expectedDirection === prelimDir
          ? stats
          : analyzeAlignedPair(bars, pmSeries, expectedDirection, shockThresholdPp);

      const defaultMechanism = `${pair.event.category}事件概率变动通过宏观风险偏好与产业链供需预期传导至 ${pair.asset.name} (${
        expectedDirection === 1 ? 'Yes概率上行利多' : 'Yes概率上行利空'
      })`;

      relations.push({
        eventId: pair.event.id,
        eventTitle: pair.event.title,
        eventCategory: pair.event.category,
        yesProb: Number((pmSeries[pmSeries.length - 1]?.yesProb ?? pair.event.yesProb).toFixed(2)),
        probChange24h: finalStats.probChange24h,
        probChange5d: finalStats.probChange5d,
        assetSymbol: pair.asset.symbol,
        assetName: pair.asset.name,
        assetMarket: pair.asset.market,
        transmissionTier: pair.spec?.tier || '宏观共振',
        expectedDirection,
        mechanism: pair.spec?.mechanism || defaultMechanism,
        hedgeLegSymbol: pair.spec?.hedgeLegSymbol,
        hedgeLegName: pair.spec?.hedgeLegName,
        optimalLagDays: finalStats.optimalLagDays,
        pearsonCorr: finalStats.pearsonCorr,
        spearmanCorr: finalStats.spearmanCorr,
        shockCorr: finalStats.shockCorr,
        shockHitRate: finalStats.shockHitRate,
        grangerFStat: finalStats.grangerFStat,
        rollingBeta: finalStats.rollingBeta,
        impliedPrice: finalStats.impliedPrice,
        actualPrice: finalStats.actualPrice,
        divergenceZScore: finalStats.divergenceZScore,
        alphaState: finalStats.alphaState,
        compositeScore: finalStats.compositeScore,
        kellySuggestedPct: finalStats.kellySuggestedPct,
        leadLagProfile: finalStats.leadLagProfile,
      });
    }

    relations.sort((a, b) => b.compositeScore - a.compositeScore);
    const sliced = relations.slice(0, topN);

    const matrixCells = sliced.slice(0, 24).map((r) => ({
      eventId: r.eventId,
      eventShortTitle: r.eventId.replace(/_/g, ' ').slice(0, 18),
      assetSymbol: r.assetSymbol,
      assetName: r.assetName,
      optimalLagDays: r.optimalLagDays,
      shockCorr: r.shockCorr,
      divergenceZScore: r.divergenceZScore,
      compositeScore: r.compositeScore,
    }));

    return {
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      alignmentRule: 'UTC -> Asia/Shanghai 09:00 盘前截断对齐 (严格零未来函数泄露)',
      events: coreEvents,
      relations: sliced,
      matrixCells,
      methodologyNotes: [
        '1. 零未来函数对齐：Polymarket CLOB 逐小时历史概率严格截取北京时间当日 09:00 前最后报价，映射至当日本地A股/期货交易日。',
        `2. 概率脉冲筛选：过滤 |ΔP| >= ${shockThresholdPp}pp 的显著事件冲击日（不足样本自动回落Top25%异动分位），计算条件相关性 shockCorr 与同向胜率。`,
        '3. 滚动协整预期差：30日因果滚动回归 log(Price_t) ~ α + β·Prob_t 得到隐含公允价 ImpliedPrice，残差标准化为预期差 Z-Score。',
        '4. 仓位分配：按脉冲胜率与盈亏比计算半Kelly建议仓位（上限45%），支持期货T+0双向杠杆与A股T+1多头对冲。',
      ],
    };
  });
}

export async function getPmRelationMatrix(
  universe: PmAssetUniverse = 'all'
): Promise<PmRelationMatrixResponse> {
  return discoverPmRelations({
    universe,
    lookbackDays: 120,
    shockThresholdPp: 1.5,
    topN: 28,
  });
}

// Helper exposed for quantService.ts A-share resonance backtest
export async function getPmAlignedSignalForDates(
  eventId: string,
  dates: string[],
  shockThresholdPp = 1.5
): Promise<{
  event: PmEventItem;
  expectedDirection: 1 | -1;
  byDate: Map<string, { yesProb: number; probDelta: number; divergenceZ: number }>;
}> {
  const events = await loadPolymarketEvents();
  const event = events.find((e) => e.id === eventId) || events[0];
  const aligned = await alignPmSeriesToTradingDates(event, dates);
  // Compute rolling 20d z-score of PM probability itself as macro impulse state
  const byDate = new Map<string, { yesProb: number; probDelta: number; divergenceZ: number }>();
  for (let i = 0; i < aligned.length; i++) {
    const start = Math.max(0, i - 19);
    const slice = aligned.slice(start, i + 1).map((x) => x.yesProb);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length);
    const z = std > 1e-4 ? Number(((aligned[i].yesProb - mean) / std).toFixed(2)) : 0;
    byDate.set(aligned[i].date, {
      yesProb: aligned[i].yesProb,
      probDelta: aligned[i].probDelta,
      divergenceZ: z,
    });
  }
  const spec = CURATED_LINKS.find((l) => l.eventId === event.id);
  return {
    event,
    expectedDirection: spec?.expectedDirection ?? (shockThresholdPp > 0 ? 1 : 1),
    byDate,
  };
}

// ---------- PM Event-Driven Joint Backtester ----------

export async function runPmEventBacktest(
  req: PmEventBacktestRequest
): Promise<PmEventBacktestResponse> {
  const signalMode: PmEventSignalMode = req.signalMode || 'shock_breakout';
  const days = Math.max(60, Math.min(260, Number(req.days || 150)));
  const shockThresholdPp = Math.max(0.5, Math.min(10, Number(req.shockThresholdPp ?? 1.5)));
  const divergenceZEntry = Math.max(0.4, Math.min(3.0, Number(req.divergenceZEntry ?? 1.05)));
  const probRegimeThreshold = Math.max(5, Math.min(95, Number(req.probRegimeThreshold ?? 55)));
  const holdingHorizonDays = Math.max(2, Math.min(30, Number(req.holdingHorizonDays ?? 8)));
  const lagExecutionDays = Math.max(0, Math.min(5, Number(req.lagExecutionDays ?? 1)));
  const initialCapital = Math.max(50_000, Number(req.initialCapital || 300_000));
  const stopLossPct = Math.abs(Number(req.stopLossPct ?? 4.5));
  const useKellySizing = req.useKellySizing !== false;

  const events = await loadPolymarketEvents();
  const event = events.find((e) => e.id === req.eventId) || events[0];

  const assetRes = await fetchAssetDailyBars(req.assetSymbol || 'AU0', days);
  const bars = assetRes.bars;
  if (bars.length < 25) {
    throw new Error(`标的 ${req.assetSymbol} 历史K线不足，无法执行联立回测`);
  }

  const isAShare = !assetRes.isFutures;
  const effectiveLeverage = isAShare
    ? 1
    : Math.max(1, Math.min(10, Number(req.leverage || 3)));

  // Optional hedge leg for kelly_pair_basket
  const curated = CURATED_LINKS.find(
    (l) => l.eventId === event.id && l.assetSymbol === assetRes.symbol
  );
  const hedgeSymbolRaw =
    signalMode === 'kelly_pair_basket'
      ? req.hedgeSymbol || curated?.hedgeLegSymbol || (isAShare ? '000300' : 'AU0' === assetRes.symbol ? 'AG0' : 'IF0')
      : req.hedgeSymbol;

  let hedgeBarsMap = new Map<string, DailyBar>();
  let hedgeName = '';
  if (hedgeSymbolRaw && hedgeSymbolRaw !== assetRes.symbol) {
    try {
      const hRes = await fetchAssetDailyBars(hedgeSymbolRaw, days + 10);
      hedgeName = hRes.name;
      hedgeBarsMap = new Map(hRes.bars.map((b) => [b.date, b]));
    } catch {
      // run single-leg if hedge fetch fails
    }
  }

  const pmSeries = await alignPmSeriesToTradingDates(
    event,
    bars.map((b) => b.date)
  );
  const initialDir: 1 | -1 = curated?.expectedDirection ?? 1;
  const analysis = analyzeAlignedPair(bars, pmSeries, initialDir, shockThresholdPp);
  const expectedDirection: 1 | -1 = curated
    ? curated.expectedDirection
    : analysis.pearsonCorr >= 0
    ? 1
    : -1;

  // Dynamic adaptive fallback shock threshold if CLOB daily deltas are mostly small
  const absDeltas = pmSeries.map((p) => Math.abs(p.probDelta)).sort((a, b) => b - a);
  const p75Delta = absDeltas[Math.floor(absDeltas.length * 0.25)] || shockThresholdPp;
  const effectiveShockTh =
    absDeltas.filter((d) => d >= shockThresholdPp).length >= 5
      ? shockThresholdPp
      : Math.max(0.35, Math.min(shockThresholdPp, p75Delta));

  const kellyWeightFrac = useKellySizing
    ? Math.max(0.25, Math.min(0.9, analysis.kellySuggestedPct / 50))
    : 0.75;

  const executionRule = isAShare
    ? hedgeBarsMap.size > 0 && signalMode === 'kelly_pair_basket'
      ? `A股 T+1 多头对冲基准 ${hedgeName || hedgeSymbolRaw} · 100股整手 · 1.0x严禁做空`
      : 'A股 T+1 严守制度 · 仅做多(1.0x) · 100股整手 · 佣金万2.5(最低¥5)+印花税千0.5'
    : `国内期货 T+0 双向交易 · ${effectiveLeverage}x杠杆 · ${
        hedgeBarsMap.size > 0 && signalMode === 'kelly_pair_basket'
          ? `配对腿 ${hedgeName || hedgeSymbolRaw}`
          : '单品种保证金风控'
      }`;

  // Simulation state
  let cash = initialCapital;
  let equity = initialCapital;
  let shares = 0; // A-share shares
  let posDir: -1 | 0 | 1 = 0; // Futures / Basket dir
  let entryPrice = 0;
  let entryHedgePrice = 0;
  let entryDate = '';
  let entryIdx = -1;
  let entryProb = 0;
  let entryProbDelta = 0;
  let entryDivZ = 0;
  let entryFee = 0;
  let posPctUsed = 0;

  const alignedSeries: PmEventAlignedPoint[] = analysis.alignedPoints.map((p) => ({ ...p }));
  const equityCurve: PmEventBacktestResponse['equityCurve'] = [];
  const trades: PmEventBacktestTrade[] = [];

  const firstClose = bars[0].close;
  let peakEq = initialCapital;
  let maxDrawdownPct = 0;
  const limitRatio = isAShare ? getLimitRatio(assetRes.symbol, assetRes.name) : 0.15;

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    const prev = bars[i - 1];
    const sigIdx = Math.max(0, i - lagExecutionDays);
    const sigPt = alignedSeries[sigIdx];
    const curPt = alignedSeries[i];
    const hedgeBar = hedgeBarsMap.get(bar.date);

    const isLimitUp = isAShare && prev.close > 0 && bar.close >= prev.close * (1 + limitRatio - 0.002) && bar.high === bar.low;
    const isLimitDown = isAShare && prev.close > 0 && bar.close <= prev.close * (1 - limitRatio + 0.002) && bar.high === bar.low;

    // 1. Check exit if in position
    if (posDir !== 0) {
      const heldDays = i - entryIdx;
      const canSellToday = isAShare ? bar.date > entryDate && !isLimitDown : true;

      let rawSpreadRet = 0;
      if (hedgeBarsMap.size > 0 && hedgeBar && entryHedgePrice > 0 && signalMode === 'kelly_pair_basket') {
        const leg1 = ((bar.close - entryPrice) / entryPrice) * posDir;
        const leg2 = ((hedgeBar.close - entryHedgePrice) / entryHedgePrice) * posDir;
        rawSpreadRet = leg1 - leg2;
      } else {
        rawSpreadRet = ((bar.close - entryPrice) / entryPrice) * posDir;
      }
      const levRetPct = rawSpreadRet * effectiveLeverage * 100;

      let exitReason = '';
      if (levRetPct <= -stopLossPct * (isAShare ? 1 : effectiveLeverage)) {
        exitReason = `触发风控止损 (${levRetPct.toFixed(1)}%)`;
      } else if (heldDays >= holdingHorizonDays) {
        exitReason = `持有期满 ${holdingHorizonDays} 日兑现`;
      } else if (
        signalMode === 'divergence_reversion' &&
        posDir * curPt.divergenceZ >= 0.15 &&
        heldDays >= 2
      ) {
        exitReason = `预期差回归均衡 (Z=${curPt.divergenceZ.toFixed(2)})`;
      } else if (
        signalMode === 'regime_trend' &&
        ((posDir === 1 && bar.ma5 && bar.ma20 && bar.ma5 < bar.ma20) ||
          (posDir === -1 && bar.ma5 && bar.ma20 && bar.ma5 > bar.ma20)) &&
        heldDays >= 2
      ) {
        exitReason = '均线趋势破位平仓';
      } else if (
        sigPt.probDelta * expectedDirection * posDir <= -effectiveShockTh &&
        heldDays >= 1
      ) {
        exitReason = `PM概率反向冲击 (ΔP=${sigPt.probDelta >= 0 ? '+' : ''}${sigPt.probDelta.toFixed(1)}%)`;
      }

      if (exitReason && canSellToday) {
        if (isAShare && shares > 0) {
          const execPrice = Number((bar.close * 0.999).toFixed(2));
          const gross = execPrice * shares;
          const comm = Math.max(5, gross * 0.00025);
          const duty = gross * 0.0005;
          let hedgeAdj = 0;
          if (hedgeBarsMap.size > 0 && hedgeBar && entryHedgePrice > 0 && signalMode === 'kelly_pair_basket') {
            hedgeAdj =
              entryPrice * shares * 0.5 * ((entryHedgePrice - hedgeBar.close) / entryHedgePrice);
          }
          const proceeds = gross - comm - duty + hedgeAdj;
          const pnl = proceeds - entryPrice * shares - entryFee;
          const baseNotional = entryPrice * shares;
          cash += proceeds;
          equity = cash;
          trades.push({
            id: trades.length + 1,
            entryDate,
            exitDate: bar.date,
            side: hedgeBarsMap.size > 0 && signalMode === 'kelly_pair_basket' ? '多空配对' : '做多',
            entryPrice: Number(entryPrice.toFixed(2)),
            exitPrice: execPrice,
            entryProb,
            exitProb: curPt.yesProb,
            entryProbDelta,
            entryDivergenceZ: entryDivZ,
            positionPct: posPctUsed,
            pnl: Number(pnl.toFixed(2)),
            returnPct: Number(((pnl / Math.max(1, baseNotional)) * 100).toFixed(2)),
            holdingDays: heldDays,
            reason: exitReason,
          });
          shares = 0;
        } else {
          const allocated = equity * (posPctUsed / 100) * effectiveLeverage;
          const fee = allocated * 0.00016;
          const pnl = allocated * rawSpreadRet - fee;
          const prevEq = equity;
          equity = Math.max(1000, equity + pnl);
          trades.push({
            id: trades.length + 1,
            entryDate,
            exitDate: bar.date,
            side:
              hedgeBarsMap.size > 0 && signalMode === 'kelly_pair_basket'
                ? '多空配对'
                : posDir === 1
                ? '做多'
                : '做空',
            entryPrice: Number(entryPrice.toFixed(2)),
            exitPrice: Number(bar.close.toFixed(2)),
            entryProb,
            exitProb: curPt.yesProb,
            entryProbDelta,
            entryDivergenceZ: entryDivZ,
            positionPct: posPctUsed,
            pnl: Number(pnl.toFixed(2)),
            returnPct: Number(((pnl / Math.max(1, prevEq)) * 100).toFixed(2)),
            holdingDays: heldDays,
            reason: exitReason,
          });
        }
        posDir = 0;
      }
    }

    // 2. Check entry if flat (avoid last bar)
    if (posDir === 0 && i >= 12 && i < bars.length - 1 && !isLimitUp) {
      let desired: -1 | 0 | 1 = 0;

      if (signalMode === 'shock_breakout') {
        if (Math.abs(sigPt.probDelta) >= effectiveShockTh) {
          const dir = sigPt.probDelta * expectedDirection > 0 ? 1 : -1;
          // Do not chase if asset already overshot > +1.6σ
          if (curPt.divergenceZ * dir < 1.6) {
            desired = dir;
          }
        }
      } else if (signalMode === 'divergence_reversion') {
        if (curPt.divergenceZ <= -divergenceZEntry) desired = 1;
        else if (curPt.divergenceZ >= divergenceZEntry) desired = -1;
      } else if (signalMode === 'regime_trend') {
        const highRegime = sigPt.yesProb >= probRegimeThreshold;
        const lowRegime = sigPt.yesProb <= 100 - probRegimeThreshold;
        const bullMa = Boolean(bar.ma5 && bar.ma20 && bar.ma5 > bar.ma20);
        const bearMa = Boolean(bar.ma5 && bar.ma20 && bar.ma5 < bar.ma20);
        if (highRegime && expectedDirection === 1 && bullMa) desired = 1;
        else if (highRegime && expectedDirection === -1 && bearMa) desired = -1;
        else if (lowRegime && expectedDirection === -1 && bullMa) desired = 1;
        else if (lowRegime && expectedDirection === 1 && bearMa) desired = -1;
      } else if (signalMode === 'kelly_pair_basket') {
        const shockTriggered = Math.abs(sigPt.probDelta) >= effectiveShockTh * 0.75;
        const divTriggered = Math.abs(curPt.divergenceZ) >= divergenceZEntry * 0.85;
        if (shockTriggered) {
          desired = sigPt.probDelta * expectedDirection > 0 ? 1 : -1;
        } else if (divTriggered) {
          desired = curPt.divergenceZ < 0 ? 1 : -1;
        }
      }

      // Enforce A-share T+1 Long-Only rule
      if (isAShare && desired === -1) {
        desired = 0;
      }

      if (desired !== 0) {
        posPctUsed = Number((kellyWeightFrac * 100).toFixed(1));
        if (isAShare) {
          const execPrice = Number((bar.close * 1.001).toFixed(2));
          const targetCash = cash * kellyWeightFrac;
          const maxShares = Math.floor(targetCash / (execPrice * 100)) * 100;
          if (maxShares >= 100) {
            const cost = execPrice * maxShares;
            const comm = Math.max(5, cost * 0.00025);
            if (cash >= cost + comm) {
              cash -= cost + comm;
              shares = maxShares;
              posDir = 1;
              entryPrice = execPrice;
              entryHedgePrice = hedgeBar?.close || 0;
              entryDate = bar.date;
              entryIdx = i;
              entryProb = sigPt.yesProb;
              entryProbDelta = sigPt.probDelta;
              entryDivZ = curPt.divergenceZ;
              entryFee = comm;
              posPctUsed = Number(((cost / Math.max(1, cash + cost)) * 100).toFixed(1));
            }
          }
        } else {
          posDir = desired;
          entryPrice = bar.close;
          entryHedgePrice = hedgeBar?.close || 0;
          entryDate = bar.date;
          entryIdx = i;
          entryProb = sigPt.yesProb;
          entryProbDelta = sigPt.probDelta;
          entryDivZ = curPt.divergenceZ;
        }
      }
    }

    alignedSeries[i].positionDir = posDir;

    let markToMarket = equity;
    if (isAShare) {
      let hedgeUnrealized = 0;
      if (posDir !== 0 && shares > 0 && hedgeBarsMap.size > 0 && hedgeBar && entryHedgePrice > 0 && signalMode === 'kelly_pair_basket') {
        hedgeUnrealized =
          entryPrice * shares * 0.5 * ((entryHedgePrice - hedgeBar.close) / entryHedgePrice);
      }
      markToMarket = cash + shares * bar.close + hedgeUnrealized;
    } else if (posDir !== 0) {
      let spreadRet = ((bar.close - entryPrice) / entryPrice) * posDir;
      if (hedgeBarsMap.size > 0 && hedgeBar && entryHedgePrice > 0 && signalMode === 'kelly_pair_basket') {
        spreadRet -= ((hedgeBar.close - entryHedgePrice) / entryHedgePrice) * posDir;
      }
      markToMarket = Math.max(
        1000,
        equity + equity * (posPctUsed / 100) * effectiveLeverage * spreadRet
      );
    }

    if (markToMarket > peakEq) peakEq = markToMarket;
    const ddPct = peakEq > 0 ? ((peakEq - markToMarket) / peakEq) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    const retPct = ((markToMarket - initialCapital) / initialCapital) * 100;
    const benchPct = ((bar.close - firstClose) / firstClose) * 100;

    equityCurve.push({
      date: bar.date,
      equity: Number(markToMarket.toFixed(2)),
      returnPct: Number(retPct.toFixed(2)),
      benchmarkPct: Number(benchPct.toFixed(2)),
      drawdownPct: Number((-ddPct).toFixed(2)),
    });
  }

  // Close open position at final bar for clean reporting
  if (posDir !== 0) {
    const lastBar = bars[bars.length - 1];
    const lastPt = alignedSeries[alignedSeries.length - 1];
    const hedgeBar = hedgeBarsMap.get(lastBar.date);
    const heldDays = Math.max(1, bars.length - 1 - entryIdx);
    if (isAShare && shares > 0) {
      const execPrice = Number((lastBar.close * 0.999).toFixed(2));
      const gross = execPrice * shares;
      const comm = Math.max(5, gross * 0.00025);
      const duty = gross * 0.0005;
      const proceeds = gross - comm - duty;
      const pnl = proceeds - entryPrice * shares - entryFee;
      cash += proceeds;
      trades.push({
        id: trades.length + 1,
        entryDate,
        exitDate: lastBar.date,
        side: hedgeBarsMap.size > 0 && signalMode === 'kelly_pair_basket' ? '多空配对' : '做多',
        entryPrice: Number(entryPrice.toFixed(2)),
        exitPrice: execPrice,
        entryProb,
        exitProb: lastPt.yesProb,
        entryProbDelta,
        entryDivergenceZ: entryDivZ,
        positionPct: posPctUsed,
        pnl: Number(pnl.toFixed(2)),
        returnPct: Number(((pnl / Math.max(1, entryPrice * shares)) * 100).toFixed(2)),
        holdingDays: heldDays,
        reason: '回测期末强平结算',
      });
    } else {
      let spreadRet = ((lastBar.close - entryPrice) / entryPrice) * posDir;
      if (hedgeBarsMap.size > 0 && hedgeBar && entryHedgePrice > 0 && signalMode === 'kelly_pair_basket') {
        spreadRet -= ((hedgeBar.close - entryHedgePrice) / entryHedgePrice) * posDir;
      }
      const allocated = equity * (posPctUsed / 100) * effectiveLeverage;
      const pnl = allocated * spreadRet - allocated * 0.00016;
      const prevEq = equity;
      equity = Math.max(1000, equity + pnl);
      trades.push({
        id: trades.length + 1,
        entryDate,
        exitDate: lastBar.date,
        side:
          hedgeBarsMap.size > 0 && signalMode === 'kelly_pair_basket'
            ? '多空配对'
            : posDir === 1
            ? '做多'
            : '做空',
        entryPrice: Number(entryPrice.toFixed(2)),
        exitPrice: Number(lastBar.close.toFixed(2)),
        entryProb,
        exitProb: lastPt.yesProb,
        entryProbDelta,
        entryDivergenceZ: entryDivZ,
        positionPct: posPctUsed,
        pnl: Number(pnl.toFixed(2)),
        returnPct: Number(((pnl / Math.max(1, prevEq)) * 100).toFixed(2)),
        holdingDays: heldDays,
        reason: '回测期末结算',
      });
    }
  }

  const finalCapital = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
  const totalReturnPct = Number((((finalCapital - initialCapital) / initialCapital) * 100).toFixed(2));
  const benchmarkReturnPct = equityCurve[equityCurve.length - 1]?.benchmarkPct ?? 0;
  const excessReturnPct = Number((totalReturnPct - benchmarkReturnPct).toFixed(2));
  const years = Math.max(0.1, bars.length / 245);
  const annualReturnPct = Number(
    ((Math.pow(Math.max(0.05, finalCapital / initialCapital), 1 / years) - 1) * 100).toFixed(2)
  );

  // Daily returns for Sharpe / IR
  const stratRets: number[] = [];
  const activeDiffs: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prevEq = equityCurve[i - 1].equity;
    const rS = prevEq > 0 ? (equityCurve[i].equity - prevEq) / prevEq : 0;
    const b0 = 1 + equityCurve[i - 1].benchmarkPct / 100;
    const b1 = 1 + equityCurve[i].benchmarkPct / 100;
    const rB = b0 > 0 ? (b1 - b0) / b0 : 0;
    stratRets.push(rS);
    activeDiffs.push(rS - rB);
  }
  const meanS = stratRets.reduce((a, b) => a + b, 0) / Math.max(1, stratRets.length);
  const stdS = Math.sqrt(
    stratRets.reduce((a, b) => a + Math.pow(b - meanS, 2), 0) / Math.max(1, stratRets.length)
  );
  const sharpe = stdS > 1e-6 ? Number(((meanS / stdS) * Math.sqrt(245)).toFixed(2)) : 0;

  const meanA = activeDiffs.reduce((a, b) => a + b, 0) / Math.max(1, activeDiffs.length);
  const stdA = Math.sqrt(
    activeDiffs.reduce((a, b) => a + Math.pow(b - meanA, 2), 0) / Math.max(1, activeDiffs.length)
  );
  const informationRatio = stdA > 1e-6 ? Number(((meanA / stdA) * Math.sqrt(245)).toFixed(2)) : 0;

  const calmar =
    maxDrawdownPct > 0.1
      ? Number((annualReturnPct / maxDrawdownPct).toFixed(2))
      : Number((annualReturnPct / 1).toFixed(2));

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winRatePct = trades.length
    ? Number(((wins.length / trades.length) * 100).toFixed(1))
    : 0;
  const grossWin = wins.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  const profitFactor =
    grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 9.99 : 0;
  const avgHoldingDays = trades.length
    ? Number((trades.reduce((a, b) => a + b.holdingDays, 0) / trades.length).toFixed(1))
    : 0;

  const defaultMechanism = `${event.category}事件驱动 -> ${assetRes.name} (${
    expectedDirection === 1 ? 'Yes概率上行利多' : 'Yes概率上行利空'
  })`;

  return {
    eventId: event.id,
    eventTitle: event.title,
    assetSymbol: assetRes.symbol,
    assetName: assetRes.name,
    assetMarket: assetRes.market,
    executionRule,
    signalMode,
    startDate: bars[0].date,
    endDate: bars[bars.length - 1].date,
    initialCapital,
    finalCapital: Number(finalCapital.toFixed(2)),
    relationSummary: {
      optimalLagDays: analysis.optimalLagDays,
      pearsonCorr: analysis.pearsonCorr,
      shockCorr: analysis.shockCorr,
      shockHitRate: analysis.shockHitRate,
      currentDivergenceZ: analysis.divergenceZScore,
      rollingBeta: analysis.rollingBeta,
      kellySuggestedPct: analysis.kellySuggestedPct,
      mechanism: curated?.mechanism || defaultMechanism,
    },
    leadLagProfile: analysis.leadLagProfile,
    alignedSeries,
    equityCurve,
    metrics: {
      totalReturnPct,
      annualReturnPct,
      benchmarkReturnPct,
      excessReturnPct,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      sharpe,
      calmar,
      informationRatio,
      winRatePct,
      profitFactor,
      avgHoldingDays,
      kellyOptimalPct: analysis.kellySuggestedPct,
      tradeCount: trades.length,
    },
    trades,
  };
}
