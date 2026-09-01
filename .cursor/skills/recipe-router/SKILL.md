---
name: recipe-router
description: Routes Chinese cooking requests into dish-name lookup or ingredient-based recommendation. Use when a cooking request must preserve the difference between “I want this dish” and “what can I make with these ingredients”.
---

# Recipe Router

Classify the request before retrieving or generating a recipe.

1. Choose `dish` when the user names a target dish or asks how to make it.
2. Choose `ingredients` when the user lists available ingredients or asks for ideas.
3. Preserve hard constraints: allergens, servings, equipment, and maximum time.
4. Never reinterpret a named dish as a generic combination of its noun phrases.
5. Return the normalized mode, query, and constraints for the next skill.

Read [references/intents.md](references/intents.md) for boundary examples.
