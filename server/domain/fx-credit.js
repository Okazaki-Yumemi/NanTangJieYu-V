'use strict';

const HOURLY_RATE = 0.005;
// 整数余数跨 tick 保存，避免反复向下取整吞掉利息；单利只按剩余本金计算。
const DENOMINATOR = 720000000n;
function accrue(account, now) {
  const loan = account.credit;
  if (!loan || now <= loan.accrued_at) return;
  const numerator = BigInt(loan.principal) * BigInt(Math.floor(now - loan.accrued_at)) + BigInt(loan.remainder || 0);
  loan.interest += Number(numerator / DENOMINATOR);
  loan.remainder = Number(numerator % DENOMINATOR);
  loan.accrued_at = now;
}
function debt(account) { return (account.debt || 0) + (account.credit ? account.credit.principal + account.credit.interest : 0); }
function repay(account) {
  let available = Math.min(account.cash, debt(account));
  account.cash -= available;
  if (account.credit) {
    for (const field of ['interest', 'principal']) {
      const paid = Math.min(available, account.credit[field]);
      account.credit[field] -= paid;
      available -= paid;
    }
    if (!account.credit.principal && !account.credit.interest) account.credit = null;
  }
  account.debt -= available;
}
module.exports = { HOURLY_RATE, accrue, debt, repay };
