"""Print a small, reproducible preview. All records and drive times are synthetic."""
import json
from planner import plan, backfill
from test_planner import fixture

crews, jobs, customers, matrix = fixture()
# Messy rows deliberately included in this otherwise standard-size scenario.
customers[0]['opted_out'] = True
customers[1]['email'] = customers[0]['email']
customers[2]['address_validated'] = False
customers[3].pop('last_service')
report = plan(crews, jobs, matrix)
suggestions = backfill(report, crews, customers, matrix)
summary = {
    'disclosure': 'Synthetic bid proof. No real customer records, live routing service, hosted agent or messages sent.',
    'input': {'crews': len(crews), 'jobs': len(jobs), 'customers': len(customers)},
    'assigned_jobs': sum(len(r['stops']) for r in report['routes']),
    'unassigned': report['unassigned'],
    'drive_minutes': sum(r['drive_minutes'] for r in report['routes']),
    'gaps': len(report['gaps']),
    'excluded': suggestions['excluded'],
    'needs_review': suggestions['needs_review'],
    'routes': report['routes'],
    'backfill_preview': [{**s, 'alternatives': s['alternatives'][:3]} for s in suggestions['suggestions']],
    'messages_sent': suggestions['messages_sent'],
}
print(json.dumps(summary, indent=2))
