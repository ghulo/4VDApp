const moneyFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatMoney = (amount: number) => moneyFormatter.format(amount);
export const formatDate = (iso: string) => dateFormatter.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormatter.format(new Date(iso));

/** "+5" / "−3": a real minus sign lines up with the plus in tabular figures. */
export const formatSignedQuantity = (quantity: number) => (quantity > 0 ? `+${quantity}` : `−${Math.abs(quantity)}`);
