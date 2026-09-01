---
name: recipe-grounder
description: Grounds recipe answers in the local HowToCook index and the project gold set. Use when retrieving Chinese recipes, ranking ingredient matches, or attaching source and confidence metadata.
---

# Recipe Grounder

Use retrieval before free generation.

1. Search the 20-recipe project gold set first for exact dish names and aliases.
2. Search `data/howtocook-index.json` for broader dish and ingredient coverage.
3. For dish mode, rank exact names above fuzzy names.
4. For ingredient mode, rank coverage, time feasibility, and technique diversity.
5. Attach source, license, confidence, and authenticity labels.
6. If no trustworthy dish match exists, say so; do not invent a named recipe.

Read [references/source-policy.md](references/source-policy.md) for provenance rules.
