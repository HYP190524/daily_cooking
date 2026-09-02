---
name: meal-set-planner
description: Combine one or two independently retrieved, zero-purchase recipes into a coherent meal while preserving each recipe's identity. Use when users want a meal from several fridge ingredients instead of one forced mixed dish.
---

# Meal Set Planner

## Goal

Build a realistic meal from independent trusted recipes, without forcing unrelated leftovers into one invented dish.

## Planning rules

1. Offer one recipe in single-dish mode and at most two recipes in meal mode.
2. Prefer complementary roles such as main + vegetable, main + soup, or staple + side.
3. Do not pair duplicate recipes, two staples, or two protein-heavy mains.
4. Estimate meal time as total active work plus the longest passive interval.
5. Keep each recipe's ingredients and steps unchanged.
6. Unused inventory is acceptable; explain that it remains for a later meal.
7. Before approval, require source, allergen, zero-purchase, time, priority, and coherence checks.
