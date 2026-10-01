Task: {{task.title}}
Source: {{task.source_url}}
Requirements: {{task.spec}}

Use the Engineering Delivery skill. Inspect relevant project instructions,
open GitHub issues and existing linked work. Produce a compact dependency-ordered
plan with vertical outcomes and only necessary horizontal prerequisites.
For each substantial slice record acceptance, relevant files, checks, dependencies
and an existing issue URL when applicable. Do not create duplicate tickets.

Write the reviewable plan to {{task.output_dir}}/plan.md. Do not implement.
Use complete for a sufficient plan, blocked for material missing requirements,
and failed for execution errors in the Machinist result contract.
