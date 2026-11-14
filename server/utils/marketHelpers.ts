import type { BoardFilter, KLineBar } from '../../src/types/market';

export function cleanCode(raw: string): string {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (digits.length >= 6) return digits.slice(-6);
  return digits.padStart(6, '0');
}

export function getMarketPrefix(code: string): 'sh' | 'sz' | 'bj' {
  const c = cleanCode(code);
  if (c.startsWith('6') || c.startsWith('9') || c.startsWith('5')) return 'sh';
  if (c.startsWith('4') || c.startsWith('8') || c.startsWith('92')) return 'bj';
  return 'sz';
}

export function toTencentSymbol(code: string): string {
  if (code.startsWith('sh') || code.startsWith('sz') || code.startsWith('bj')) {
    return code;
  }
  return `${getMarketPrefix(code)}${cleanCode(code)}`;
}

export function toEastMoneySecid(code: string): string {
  if (code.startsWith('BK')) return `90.${code}`;
  if (code.startsWith('90.')) return code;
  if (code.includes('.')) return code;
  const c = cleanCode(code);
  // Special known index codes
  if (c === '000001' || c === '000300' || c === '000680' || c === '000905') {
    // caller should pass 1.000001 explicitly for index; stock 000001 is PingAn Bank (sz)
  }
  const prefix = getMarketPrefix(c);
  return prefix === 'sh' ? `1.${c}` : `0.${c}`;
}

export function getMarketLabel(code: string): string {
  const c = cleanCode(code);
  if (c.startsWith('688') || c.startsWith('689')) return '科创板';
  if (c.startsWith('300') || c.startsWith('301')) return '创业板';
  if (c.startsWith('8') || c.startsWith('4') || c.startsWith('92')) return '北交所';
  if (c.startsWith('6')) return '沪市主板';
  return '深市主板';
}

export function getBoardType(code: string, name = ''): BoardFilter {
  if (name.includes('ST') || name.includes('*ST')) return 'st';
  const c = cleanCode(code);
  if (c.startsWith('688') || c.startsWith('689')) return 'star';
  if (c.startsWith('300') || c.startsWith('301')) return 'chinext';
  if (c.startsWith('8') || c.startsWith('4') || c.startsWith('92')) return 'bse';
  return 'main';
}

export function getBoardBadge(board: BoardFilter): string | undefined {
  switch (board) {
    case 'chinext':
      return '创';
    case 'star':
      return '科';
    case 'bse':
      return '北';
    case 'st':
      return 'ST';
    default:
      return undefined;
  }
}

export function getLimitRatio(code: string, name = ''): number {
  if (name.includes('ST') || name.includes('*ST')) return 0.05;
  const c = cleanCode(code);
  if (c.startsWith('300') || c.startsWith('301') || c.startsWith('688') || c.startsWith('689')) {
    return 0.2;
  }
  if (c.startsWith('8') || c.startsWith('4') || c.startsWith('92')) return 0.3;
  return 0.1;
}

export function calcLimitPrices(prevClose: number, code: string, name = ''): { up: number; down: number } {
  const ratio = getLimitRatio(code, name);
  return {
    up: Number((prevClose * (1 + ratio)).toFixed(2)),
    down: Number((prevClose * (1 - ratio)).toFixed(2)),
  };
}

export function formatTimeInt(val?: number | string): string {
  if (!val) return '-';
  const s = String(val).padStart(6, '0');
  if (s.length !== 6) return String(val);
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

export function getBeijingTimeInfo(): {
  dateStr: string;
  compactDate: string;
  timeStr: string;
  isMarketOpen: boolean;
} {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const bj = new Date(utcMs + 8 * 3600 * 1000);
  const y = bj.getFullYear();
  const m = String(bj.getMonth() + 1).padStart(2, '0');
  const d = String(bj.getDate()).padStart(2, '0');
  const hh = bj.getHours();
  const mm = bj.getMinutes();
  const ss = String(bj.getSeconds()).padStart(2, '0');
  const day = bj.getDay(); // 0 Sun, 6 Sat
  const mins = hh * 60 + mm;
  const isWeekday = day >= 1 && day <= 5;
  const inMorning = mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30;
  const inAfternoon = mins >= 13 * 60 && mins <= 15 * 60;
  return {
    dateStr: `${y}-${m}-${d}`,
    compactDate: `${y}${m}${d}`,
    timeStr: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss}`,
    isMarketOpen: isWeekday && (inMorning || inAfternoon),
  };
}

export function enrichKLineIndicators(
  bars: (Omit<KLineBar, 'ma5' | 'ma10' | 'ma20' | 'ma60' | 'vol5' | 'vol10' | 'volRatio'> & {
    volRatio?: number;
  })[],
  code?: string,
  name?: string
): KLineBar[] {
  const limitRatio = code ? getLimitRatio(code, name || '') : 0.1;
  const out: KLineBar[] = [];

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = i > 0 ? bars[i - 1].close : b.open;
    const changePct =
      typeof b.changePct === 'number' && !Number.isNaN(b.changePct) && i > 0
        ? b.changePct
        : prevClose > 0
        ? Number((((b.close - prevClose) / prevClose) * 100).toFixed(2))
        : 0;

    const avgClose = (n: number) => {
      if (i + 1 < n) return null;
      let s = 0;
      for (let k = i - n + 1; k <= i; k++) s += bars[k].close;
      return Number((s / n).toFixed(2));
    };

    const avgVol = (n: number) => {
      if (i + 1 < n) return null;
      let s = 0;
      for (let k = i - n + 1; k <= i; k++) s += bars[k].volume;
      return Number((s / n).toFixed(0));
    };

    const vol5 = avgVol(5);
    const vol10 = avgVol(10);
    const prevVol5 = i >= 5 ? (() => {
      let s = 0;
      for (let k = i - 5; k < i; k++) s += bars[k].volume;
      return s / 5;
    })() : null;

    const volRatio =
      b.volRatio ??
      (prevVol5 && prevVol5 > 0 ? Number((b.volume / prevVol5).toFixed(2)) : 1.0);

    let marker: KLineBar['marker'] = b.marker ?? null;
    if (!marker && code && prevClose > 0 && !code.startsWith('BK') && code !== '000001') {
      const upLimit = Number((prevClose * (1 + limitRatio)).toFixed(2));
      const downLimit = Number((prevClose * (1 - limitRatio)).toFixed(2));
      if (b.close >= upLimit - 0.015) {
        marker = '板';
      } else if (b.high >= upLimit - 0.015 && b.close < upLimit - 0.015) {
        marker = '炸';
      } else if (b.close <= downLimit + 0.015) {
        marker = '跌';
      }
    }

    out.push({
      ...b,
      changePct,
      volRatio,
      ma5: avgClose(5),
      ma10: avgClose(10),
      ma20: avgClose(20),
      ma60: avgClose(60),
      vol5,
      vol10,
      marker,
    });
  }
  return out;
}
