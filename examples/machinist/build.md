Task: {{task.title}}
Source: {{task.source_url}}
Requirements: {{task.spec}}

Read {{task.output_dir}}/plan.md and the relevant Engineering Delivery protocols.
Reconcile the plan with current files, issues, existing branches and linked PRs.
Preserve prior work; do not assume a retry had no effects. Deliver small slices,
connect real components, run relevant checks, and review the final diff.

Missing tools/services are verification gaps: inspect supported local alternatives,
run available meaningful checks, and complete independent work. Do not loop on
unchanged setup errors. Do not weaken tests or describe static checks as end-to-end
proof. Do not install/change global environments merely to clear a status.

Write {{task.output_dir}}/delivery.md with implemented behavior, exact checks,
results, unverified criteria, issue/PR links, remaining work and recovery steps.
Update tickets or open a PR only if the task explicitly requests it. Never merge
or deploy from this example. Use complete only for delivery acceptance with its
required verification; otherwise retain the report and return an honest blocked
or failed result. Interactive advisory work can finish with a partial handoff;
Machinist can pause progression at this stage boundary.
