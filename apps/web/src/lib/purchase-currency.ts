// ISO 4217 List One, published 2026-09-17 by SIX, the maintenance agency.
// Excludes XTS (testing) and XXX (no currency).
const currencyCodes = `
AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD
CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR
FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK
JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD
MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD
OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL
THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST
XAD XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XUA YER ZAR ZMW ZWG
`
  .trim()
  .split(/\s+/);

const currencyNames = new Intl.DisplayNames(undefined, { type: 'currency', fallback: 'none' });

export const purchaseCurrencies = currencyCodes.map((code) => {
  const name = currencyNames.of(code);
  return { code, label: name ? `${code} · ${name}` : code };
});

export function formatPurchaseAmount(amount: string | null, currency: string | null): string {
  if (!amount) return '—';

  const value = Number(amount);
  // Keep the stored decimal intact when the magnitude exceeds reliable numeric cent precision.
  if (!Number.isFinite(value) || Math.abs(value) >= 1e13) {
    return currency ? `${currency} ${amount}` : amount;
  }

  const precision = { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  if (!currency) return new Intl.NumberFormat(undefined, precision).format(value);
  if (!/^[A-Z]{3}$/.test(currency)) return `${currency} ${amount}`;

  return new Intl.NumberFormat(undefined, {
    ...precision,
    style: 'currency',
    currencyDisplay: 'code',
    currency,
  }).format(value);
}
