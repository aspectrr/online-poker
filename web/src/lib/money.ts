/** cents (int) -> "$1.25". Negative-safe. */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

/** cents -> "$0.10/$0.20" blinds label. */
export function blinds(sbCents: number, bbCents: number): string {
  return `${money(sbCents)}/${money(bbCents)}`;
}

// ponytail: no currency/i18n parameterization — USD-only until a real need lands.
