---
name: inventory-composer
description: Adapt grounded cooking techniques into zero-purchase recipes or meal plans when users want to consume fridge leftovers without buying additional ingredients.
---

# Inventory Composer

Turn the user's inventory into an executable recipe or meal plan while keeping real recipes as technique references rather than copying incompatible ingredient lists.

## Required outcome

- Treat every item in `ingredients` as must-use inventory.
- Treat only items explicitly listed in `pantry` as available seasonings.
- Never silently introduce eggs, dairy, aromatics, sauces, vegetables, proteins, or other groceries.
- Prefer one coherent dish in `single` scope. In `meal` scope, split ingredients across a small meal when forcing everything into one dish would reduce plausibility.
- Preserve food-safety steps for raw meat, seafood, eggs, and reheated leftovers.
- Return an inventory proof containing used, unused, missing, pantry-used, and coverage ratio.

Use the deterministic zero-purchase rules in [references/zero-purchase-rules.md](references/zero-purchase-rules.md) whenever validating or adapting a candidate.

## Grounding policy

Retrieve trustworthy recipes to identify useful technique order, heat control, and doneness checks. The retrieved ingredient list is not authorization to add unavailable ingredients. Label an adapted result as inventory-generated and retain the reference URL when one exists.

If no safe plan can cover the inventory within the user's time limit, stop and explain the conflict. Do not disguise a partial match as a complete clean-fridge plan.
