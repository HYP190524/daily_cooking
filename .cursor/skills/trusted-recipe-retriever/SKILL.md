---
name: trusted-recipe-retriever
description: Retrieve complete recipes only from the local HowToCook index and manually verified gold set. Use for dish-name lookup or pantry-based recipe candidate retrieval where source grounding matters.
---

# Trusted Recipe Retriever

## Goal

Return real, source-backed recipes rather than generated dish identities or generic technique templates.

## Source policy

1. Search the hand-verified gold set first, then the local HowToCook index.
2. A candidate must retain its original name, ingredient list, steps, and source URL.
3. Never fabricate a recipe when retrieval returns no result.
4. Deduplicate by normalized dish name; prefer the gold-set version.
5. Surface a clear no-result state so the product can ask for revised inventory.
