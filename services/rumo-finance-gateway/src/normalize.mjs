const cents = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('invalid_amount');
  return Math.round(Math.abs(value) * 100);
};
export function normalizeAccount(row) {
  if (typeof row?.id !== 'string' || typeof row?.name !== 'string') throw Error('invalid_account');
  return {
    id: row.id,
    name: row.name,
    type:
      row.type === 'CREDIT'
        ? 'credit_card'
        : row.subtype === 'SAVINGS_ACCOUNT'
          ? 'savings'
          : 'checking',
    currency: row.currencyCode,
    lastFour:
      typeof row.number === 'string' ? row.number.replace(/\D/g, '').slice(-4) || null : null,
    balanceCents: typeof row.balance === 'number' ? Math.round(row.balance * 100) : null,
  };
}
export function normalizeTransaction(row, accountType) {
  if (
    typeof row?.id !== 'string' ||
    typeof row?.accountId !== 'string' ||
    typeof row?.description !== 'string' ||
    typeof row?.date !== 'string'
  )
    throw Error('invalid_transaction');
  if (row.currencyCode !== 'BRL') throw Error('unsupported_currency');
  const date = row.date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('invalid_date');
  const operation = row.operationType;
  const category = String(row.category || '').toLowerCase();
  let type;
  if (operation === 'PAGAMENTO_FATURA') type = 'card_payment';
  else if (operation === 'ESTORNO') type = 'refund';
  else if (category.includes('transfer')) type = 'transfer';
  else if (accountType === 'credit_card') {
    // Pluggy Sandbox can return negative CREDIT card purchases. Never infer income
    // from a card CREDIT; ambiguous credits remain in manual review.
    type =
      row.type === 'DEBIT' ||
      (row.type === 'CREDIT' &&
        row.amount < 0 &&
        category.length > 0 &&
        !/payment|pagamento|fatura|bill/.test(category))
        ? 'card_purchase'
        : 'card_payment';
  } else type = row.type === 'CREDIT' ? 'income' : 'expense';
  return {
    id: row.id,
    accountId: row.accountId,
    date,
    postedAt: row.status === 'POSTED' ? row.updatedAt || row.date : null,
    description: row.description,
    amountCents: cents(row.amount),
    type,
    status: row.status === 'PENDING' ? 'pending' : 'posted',
    merchant: typeof row.merchant?.name === 'string' ? row.merchant.name : null,
    rawCategory: typeof row.category === 'string' ? row.category : null,
  };
}
