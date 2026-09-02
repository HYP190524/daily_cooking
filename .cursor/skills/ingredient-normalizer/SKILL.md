---
name: ingredient-normalizer
description: Normalize Chinese ingredient names, aliases, quantities, and optional annotations before pantry recipe retrieval. Use when converting user-entered fridge inventory or recipe ingredient lines into comparable canonical terms.
---

# Ingredient Normalizer

## Goal

Turn noisy Chinese kitchen input into stable ingredient terms without confusing related but distinct foods.

## Rules

1. Remove quantities, units, preparation notes, and optional markers before matching.
2. Map true aliases such as `琵琶腿 → 鸡腿` and `西红柿 → 番茄`.
3. Allow parent matches only for safe categories such as `鸡腿 ↔ 鸡肉`.
4. Keep lookalikes distinct: `胡萝卜` must not match `白萝卜`.
5. Preserve the user's original display text for coverage explanations.

## Output

Return canonical terms for retrieval plus original terms for UI evidence.
