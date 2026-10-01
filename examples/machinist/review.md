Task: {{task.title}}
Source: {{task.source_url}}
Requirements: {{task.spec}}

Read {{task.output_dir}}/plan.md, {{task.output_dir}}/delivery.md and the current
diff. Use the Engineering Delivery review protocols and trace acceptance to actual
evidence. Verify actionable findings against source/checks. Review correctness,
integration gaps and relevant security/performance/recovery risks.

Write {{task.output_dir}}/review.md with findings by severity, evidence, open
verification gaps and a recommended next action. Do not modify implementation,
merge or deploy. Use complete when the review stage produced its requested report;
that outcome does not independently certify or release the software. Return blocked
if missing source/access prevents a useful review. Keep earlier reports intact.
