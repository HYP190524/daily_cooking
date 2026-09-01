# Zero-purchase rules

## Inventory closure

For an ingredient-mode plan to pass:

```text
recipe ingredients ⊆ user inventory ∪ declared pantry
unused must-use inventory = ∅
allergen conflicts = ∅
```

Quantities, preparation notes, and optional markers do not create new inventory identities. Remove optional source ingredients that are not available instead of listing them as purchases.

## Scope decisions

- `single`: use all must-use ingredients in one coherent dish.
- `meal`: the union of all dishes must use every must-use ingredient; individual dishes do not need to contain everything.
- When both forms are plausible, provide one combined option and one split-meal option so the user can choose.

## Failure behavior

- Reject candidates that need any undeclared non-pantry ingredient.
- Reject candidates that leave a must-use ingredient unused.
- Reject unsafe time compression.
- If every candidate fails, report the failed constraint and ask the user to extend time, remove a must-use item, or explicitly add an available pantry item.
