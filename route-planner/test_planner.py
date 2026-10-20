import random
import unittest
from planner import plan, backfill, travel


def fixture(seed=7):
    rng = random.Random(seed)
    nodes = ['depot'] + [f'n{i}' for i in range(30)]
    matrix = {a: {b: 0 if a == b else rng.randint(3, 18) for b in nodes} for a in nodes}
    crews = [{'id': f'crew{i}', 'date': '2026-10-26', 'start': 480, 'end': 1020, 'depot': 'depot', 'skills': ['general']} for i in range(3)]
    jobs = [{'id': f'job{i}', 'date': '2026-10-26', 'node': f'n{i}', 'duration': 25, 'window': [480, 1020], 'skills': ['general']} for i in range(18)]
    customers = [{'id': f'customer{i}', 'email': f'customer{i}@example.invalid', 'node': f'n{i % 30}', 'address_validated': True, 'duration': 25, 'skills': ['general'], 'last_service': '2026-08-01', 'interval_days': 30, 'do_not_contact': False, 'opted_out': False} for i in range(200)]
    return crews, jobs, customers, matrix


def verify_invariants(test, crews, jobs, matrix, report):
    by_id = {j['id']: j for j in jobs}
    crews_by_id = {c['id']: c for c in crews}
    accounted = [s['job'] for r in report['routes'] for s in r['stops']] + [u['job'] for u in report['unassigned']]
    test.assertCountEqual(accounted, by_id)
    test.assertEqual(len(accounted), len(set(accounted)))
    for route in report['routes']:
        crew = crews_by_id[route['crew']]
        now, node, drive = crew['start'], crew['depot'], 0
        for stop in route['stops']:
            job = by_id[stop['job']]
            test.assertEqual(job['date'], crew['date'])
            test.assertTrue(set(job['skills']).issubset(crew['skills']))
            leg = travel(matrix, node, stop['node'])
            test.assertIsNotNone(leg)
            test.assertGreaterEqual(stop['start'], max(now + leg, job['window'][0]))
            test.assertEqual(stop['end'] - stop['start'], job['duration'])
            test.assertLessEqual(stop['end'], min(job['window'][1], crew['end']))
            now, node, drive = stop['end'], stop['node'], drive + leg
        home = travel(matrix, node, crew['depot'])
        test.assertLessEqual(now + home, crew['end'])
        test.assertEqual(route['drive_minutes'], drive + home)


class PlannerTests(unittest.TestCase):
    def test_buyer_scale_and_every_alternative(self):
        crews, jobs, customers, matrix = fixture()
        report = plan(crews, jobs, matrix)
        verify_invariants(self, crews, jobs, matrix, report)
        self.assertFalse(report['unassigned'])
        filled = backfill(report, crews, customers, matrix)
        self.assertEqual(filled['messages_sent'], 0)
        gap_map = {(g['crew'], g['index']): g for g in report['gaps']}
        self.assertGreater(sum(len(s['alternatives']) for s in filled['suggestions']), 0)
        for group in filled['suggestions']:
            gap = gap_map[(group['crew'], group['gap_index'])]
            for candidate in group['alternatives']:
                self.assertGreaterEqual(candidate['start'], gap['from_time'] + matrix[gap['from_node']][candidate['node']])
                self.assertLessEqual(candidate['end'] + matrix[candidate['node']][gap['to_node']], gap['to_time'])
                self.assertIn('possible', candidate['draft'])
                self.assertGreaterEqual(candidate['overdue_days'], 0)

    def test_adversarial_randomized_input_accounting(self):
        for seed in range(100):
            crews, jobs, _, matrix = fixture(seed)
            rng = random.Random(seed)
            for i, job in enumerate(jobs):
                start = rng.randint(480, 990)
                job['window'] = [start, min(start + rng.randint(10, 120), 1020)]
                if i % 7 == 0:
                    job['skills'] = ['specialist']
                if i % 11 == 0:
                    matrix['depot'][job['node']] = None
            report = plan(crews, jobs, matrix)
            verify_invariants(self, crews, jobs, matrix, report)

    def test_missing_skills_and_impossible_window_explicit(self):
        crews, jobs, _, matrix = fixture()
        jobs[0]['skills'] = ['electrician']
        jobs[1]['window'] = [480, 481]
        report = plan(crews, jobs[:2], matrix)
        self.assertEqual({j['job'] for j in report['unassigned']}, {'job0', 'job1'})

    def test_unreachable_is_not_free_travel(self):
        crews, jobs, _, matrix = fixture()
        matrix['depot']['n0'] = None
        report = plan(crews[:1], jobs[:1], matrix)
        self.assertEqual(len(report['unassigned']), 1)
        for value in [None, -1, float('nan'), float('inf'), True, '5']:
            self.assertIsNone(travel({'a': {'b': value}}, 'a', 'b'))

    def test_optout_propagates_through_transitive_duplicates(self):
        crews, _, customers, matrix = fixture()
        customers = customers[:3]
        customers[0].update(id='A', email='shared@example.invalid', opted_out=True)
        customers[1].update(id='B', email=' SHARED@example.invalid ')
        customers[2].update(id='B', email='other@example.invalid')
        report = backfill(plan(crews, [], matrix), crews, customers, matrix)
        self.assertEqual(len(report['excluded']), 3)
        self.assertTrue(all(not s['alternatives'] for s in report['suggestions']))

    def test_duplicate_without_optout_requires_review(self):
        crews, _, customers, matrix = fixture()
        customers[1]['email'] = customers[0]['email']
        report = backfill(plan(crews, [], matrix), crews, customers[:2], matrix)
        self.assertEqual(len(report['excluded']), 2)
        self.assertTrue(all('duplicate' in c['reason'] for c in report['excluded']))

    def test_bad_addresses_unknown_consent_and_missing_dates(self):
        crews, _, customers, matrix = fixture()
        customers = customers[:5]
        customers[0]['address_validated'] = False
        del customers[1]['last_service']
        customers[2]['last_service'] = '2026-02-30'
        customers[3]['last_service'] = '2027-01-01'
        del customers[4]['do_not_contact']
        report = backfill(plan(crews, [], matrix), crews, customers, matrix)
        self.assertEqual(len(report['excluded']), 2)
        self.assertEqual(len(report['needs_review']), 3)
        self.assertTrue(all(not s['alternatives'] for s in report['suggestions']))

    def test_service_due_on_date_and_future_not_due(self):
        crews, _, customers, matrix = fixture()
        customers[0]['due_date'] = '2026-10-26'
        customers[1]['due_date'] = '2026-10-27'
        report = backfill(plan(crews[:1], [], matrix), crews[:1], customers[:2], matrix)
        self.assertEqual([a['customer'] for a in report['suggestions'][0]['alternatives']], ['customer0'])

    def test_all_empty_days_have_gaps_and_jobs_stay_on_date(self):
        crews, jobs, _, matrix = fixture()
        crews = [dict(crews[0], id=f'day{i}', date=f'2026-10-{26+i}') for i in range(5)]
        report = plan(crews, jobs[:1], matrix)
        verify_invariants(self, crews, jobs[:1], matrix, report)
        self.assertEqual(len(report['gaps']), 5)
        self.assertEqual(sum(not r['stops'] for r in report['routes']), 4)

    def test_duplicate_job_ids_rejected(self):
        crews, jobs, _, matrix = fixture()
        with self.assertRaisesRegex(ValueError, 'duplicate job'):
            plan(crews, jobs + jobs[:1], matrix)

    def test_leading_internal_trailing_gaps(self):
        crews, jobs, _, matrix = fixture()
        for row in matrix.values():
            for node in row:
                row[node] = 0
        jobs[0]['window'], jobs[1]['window'] = [600, 625], [800, 825]
        report = plan(crews[:1], jobs[:2], matrix)
        self.assertEqual([g['usable_minutes_before_detour'] for g in report['gaps']], [120, 175, 195])

    def test_detour_must_preserve_later_appointment(self):
        crews, jobs, customers, matrix = fixture()
        for row in matrix.values():
            for node in row:
                row[node] = 0
        jobs[0]['window'] = [540, 565]
        customers[0].update(node='n2', duration=30)
        matrix['depot']['n2'], matrix['n2']['n0'] = 10, 30
        report = plan(crews[:1], jobs[:1], matrix)
        result = backfill(report, crews[:1], customers[:1], matrix)
        self.assertFalse(result['suggestions'][0]['alternatives'])
        self.assertTrue(result['suggestions'][1]['alternatives'])

    def test_return_to_depot_and_directed_travel(self):
        crews, jobs, _, matrix = fixture()
        matrix['depot']['n0'], matrix['n0']['depot'] = 5, 50
        jobs[0]['window'] = [970, 995]
        self.assertEqual(len(plan(crews[:1], jobs[:1], matrix)['unassigned']), 1)
        matrix['n0']['depot'] = 10
        route = plan(crews[:1], jobs[:1], matrix)['routes'][0]
        self.assertEqual(route['drive_minutes'], 15)
        self.assertEqual(route['return_at'], 1005)

    def test_baseline_savings_and_infeasibility_are_honest(self):
        crews, jobs, _, matrix = fixture()
        jobs = jobs[:2]
        matrix['depot']['n0'], matrix['n0']['n1'], matrix['n1']['depot'] = 30, 30, 30
        matrix['depot']['n1'], matrix['n1']['n0'], matrix['n0']['depot'] = 5, 5, 5
        route = plan(crews[:1], jobs, matrix)['routes'][0]
        self.assertEqual(route['drive_minutes'], 15)
        self.assertEqual(route['comparison']['input_order_minutes'], 90)
        jobs[0]['window'], jobs[1]['window'] = [700, 725], [500, 525]
        route = plan(crews[:1], jobs, matrix)['routes'][0]
        self.assertIsNone(route['comparison']['input_order_minutes'])
        self.assertIn('unavailable', route['comparison']['explanation'])


if __name__ == '__main__':
    unittest.main()
