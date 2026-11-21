---
"@kikis-app/kikis-app": patch
---

- [SDK] `amountToStroops` and `stroopsToAmount` now validate the asset scale up front, rejecting a negative, non-integer, `NaN`, or `Infinity` `decimals` with a distinct `Invalid asset scale` error instead of surfacing the bad scale later as a BigInt conversion or negative-exponent failure, or as a misleading "excess amount precision" message (a negative scale made `frac.length > decimals` true for any amount, so a valid amount was blamed). Genuine amount over-precision against a valid scale is still reported as before (Fixes #290).
