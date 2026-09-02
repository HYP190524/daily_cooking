---
name: pantry-ranker
description: Rank trusted recipes against available fridge ingredients, priority ingredients, and declared pantry staples under a zero-new-ingredient constraint. Use when recommending what a user can cook from current inventory.
---

# Pantry Ranker

## Goal

Find trusted recipes that can actually be completed without buying ingredients.

## Ranking contract

1. Separate fridge ingredients, priority ingredients, and declared pantry staples.
2. Reject any executable candidate with a required missing ingredient.
3. Reward priority-ingredient coverage, inventory use, trusted source confidence, taste fit, and time fit.
4. Treat optional recipe ingredients as optional.
5. Report used, unused, pantry-used, and missing ingredients explicitly.
6. Never require all fridge items to appear in one recipe.
