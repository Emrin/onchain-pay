export interface Prices {
  btcUsd: number;
  ltcUsd: number;
}

const FALLBACK: Prices = { btcUsd: 97000, ltcUsd: 85 };
const API_URL = process.env.API_URL ?? 'http://api:3000';

export async function getPrices(): Promise<Prices> {
  try {
    const res = await fetch(`${API_URL}/api/prices`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return FALLBACK;
    const data = (await res.json()) as { btcUsd?: number; ltcUsd?: number };
    return {
      btcUsd: data.btcUsd ?? FALLBACK.btcUsd,
      ltcUsd: data.ltcUsd ?? FALLBACK.ltcUsd,
    };
  } catch {
    return FALLBACK;
  }
}

export function usdToSats(usd: number, btcUsd: number): number {
  return Math.round((usd / btcUsd) * 1e8);
}

export function usdToLitoshis(usd: number, ltcUsd: number): number {
  return Math.round((usd / ltcUsd) * 1e8);
}

export function satsToUsd(sats: number | string, btcUsd: number): number {
  return (Number(sats) / 1e8) * btcUsd;
}

export function litoshisToUsd(litoshis: number | string, ltcUsd: number): number {
  return (Number(litoshis) / 1e8) * ltcUsd;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}
