# Settlement Calculations Guide

This document explains how insurance settlements are calculated for various claim types.

---

## Actual Cash Value (ACV) Calculation

ACV = Replacement Cost − Depreciation

### Depreciation Formula

For vehicles:
```
Annual Depreciation Rate = 15% (first year), 10% (subsequent years)
ACV = Purchase Price × (1 − 0.15) × (1 − 0.10)^(age − 1)
```

**Example:**
- Vehicle purchased for $30,000, now 4 years old
- Year 1: $30,000 × 0.85 = $25,500
- Year 2: $25,500 × 0.90 = $22,950
- Year 3: $22,950 × 0.90 = $20,655
- Year 4: $20,655 × 0.90 = $18,589.50

ACV = **$18,589.50**

## Total Loss Threshold

A vehicle is considered a total loss when:

```
Repair Cost > (ACV × Total Loss Percentage)
```

Total loss percentages vary by state:
- Most states: **75%** of ACV
- Some states: **70%** of ACV
- Our state: **75%** (verify with state-regulations.md)

**Example:** If ACV = $18,589.50 and repairs = $14,500
- Threshold: $18,589.50 × 0.75 = $13,942.13
- $14,500 > $13,942.13 → **Total loss declared**

## Bodily Injury Settlement Factors

Settlements consider:
1. **Medical expenses** (actual, documented)
2. **Lost wages** (verified by employer)
3. **Pain and suffering** — typically 1.5× to 5× medical expenses
4. **Property damage** (if combined claim)
5. **Comparative negligence** — settlement reduced by your fault percentage

### Pain and Suffering Multiplier

| Injury Severity | Multiplier Range |
|----------------|-----------------|
| Minor (soft tissue, bruises) | 1.5× – 2× |
| Moderate (fractures, moderate whiplash) | 2× – 3× |
| Severe (surgery, long recovery) | 3× – 5× |
| Permanent disability | 5× – 10× |

### Comparative Negligence Example

- Total damages: $50,000
- Your fault: 20%
- Settlement: $50,000 × (1 − 0.20) = **$40,000**

Note: Some states use contributory negligence (any fault = $0). Check `state-regulations.md`.

## Subrogation

When your insurer pays your claim but another party is at fault:
1. Insurer pays your claim (minus deductible)
2. Insurer pursues the at-fault party's insurer for reimbursement
3. If successful, your deductible is refunded

## Diminished Value

After repairs, a vehicle may be worth less than before the accident. Some states allow diminished value claims:

```
Diminished Value = ACV × 0.10 × Damage Modifier × Mileage Modifier
```

Damage modifiers:
| Damage Level | Modifier |
|-------------|----------|
| Severe structural | 1.00 |
| Major panel/structural | 0.75 |
| Moderate | 0.50 |
| Minor | 0.25 |

Not all states recognize diminished value claims. Consult `state-regulations.md`.
