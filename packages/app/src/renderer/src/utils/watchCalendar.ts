export function monthCells(month: string) {
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const length = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length }, (_, index) => {
    const date = new Date(Date.UTC(year, number - 1, index - offset + 1));
    const iso = date.toISOString().slice(0, 10);
    return { date: iso, day: date.getUTCDate(), current: iso.startsWith(`${month}-`) };
  });
}
export function shiftMonth(month: string, amount: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + amount, 1)).toISOString().slice(0, 7);
}
