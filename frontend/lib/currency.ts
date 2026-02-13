const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export const formatINR = (amount: number) => {
  const value = Number.isFinite(amount) ? amount : 0;
  return inrFormatter.format(value);
};
