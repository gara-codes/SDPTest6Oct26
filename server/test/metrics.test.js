import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseRepo } from '../lib/parse.js';
import { computeMetrics } from '../lib/metrics.js';
import { parseMailmap, buildAuthorMap } from '../lib/mailmap.js';
import { gitIn, tmpdir } from './helpers.js';

const T = 1700000000; // fixture base timestamp

const ALICE = 'Alice <a@x>';
const ALICE_WORK = 'Alice Work <alice@work>';
const BOB = 'Bob <b@x>';

function commitAt(dir, { message, ts, name, email }) {
  gitIn(dir, ['add', '-A']);
  gitIn(
    dir,
    ['commit', '-q', '-m', message],
    {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: 'Committer',
      GIT_COMMITTER_EMAIL: 'c@x',
      GIT_AUTHOR_DATE: `${ts} +0000`,
      GIT_COMMITTER_DATE: `${ts} +0000`,
    }
  );
}

// Fixture history (all dates at T+ offsets, committer date = author date):
//   c1 @+100 Alice      add README.md (3 lines)
//   c2 @+200 Bob        add src/app.js (2 lines) + binary logo.png
//   c3 @+300 Alice      edit README.md (+1/-1)
//   c4 @+400 AliceWork  append 2 lines to src/app.js
//   c5 @+500 Bob        delete README.md
//   c6 @+600 Alice      pure rename src/app.js -> src/main.js
//   c7 @+700 Bob        rename src/main.js -> lib/main.js and edit (+1/-1)
//   c8 @+800 Bob        add doc.txt (5 lines)  [on branch feat]
//   m  @+900 Alice      merge feat into main (--no-ff) — excluded via --no-merges
async function makeFixture() {
  const dir = tmpdir('rat-metrics-');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  gitIn(dir, ['init', '-q', '-b', 'main']);

  fs.writeFileSync(path.join(dir, 'README.md'), 'l1\nl2\nl3\n');
  commitAt(dir, { message: 'c1', ts: T + 100, name: 'Alice', email: 'a@x' });

  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'a\nb\n');
  fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  commitAt(dir, { message: 'c2', ts: T + 200, name: 'Bob', email: 'b@x' });

  fs.writeFileSync(path.join(dir, 'README.md'), 'l1\nx\nl3\n');
  commitAt(dir, { message: 'c3', ts: T + 300, name: 'Alice', email: 'a@x' });

  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'a\nb\nc\nd\n');
  commitAt(dir, { message: 'c4', ts: T + 400, name: 'Alice Work', email: 'alice@work' });

  fs.rmSync(path.join(dir, 'README.md'));
  commitAt(dir, { message: 'c5', ts: T + 500, name: 'Bob', email: 'b@x' });

  gitIn(dir, ['mv', 'src/app.js', 'src/main.js']);
  commitAt(dir, { message: 'c6', ts: T + 600, name: 'Alice', email: 'a@x' });

  fs.mkdirSync(path.join(dir, 'lib'));
  gitIn(dir, ['mv', 'src/main.js', 'lib/main.js']);
  fs.writeFileSync(path.join(dir, 'lib', 'main.js'), 'z\nb\nc\nd\n');
  commitAt(dir, { message: 'c7', ts: T + 700, name: 'Bob', email: 'b@x' });

  gitIn(dir, ['branch', 'feat']);
  fs.writeFileSync(path.join(dir, 'doc.txt'), 'd1\nd2\nd3\nd4\nd5\n');
  commitAt(dir, { message: 'c8', ts: T + 800, name: 'Bob', email: 'b@x' });
  gitIn(dir, ['checkout', '-q', 'main']);
  gitIn(
    dir,
    ['merge', '--no-ff', '-q', 'feat', '-m', 'merge feat'],
    {
      GIT_AUTHOR_NAME: 'Alice',
      GIT_AUTHOR_EMAIL: 'a@x',
      GIT_COMMITTER_NAME: 'Committer',
      GIT_COMMITTER_EMAIL: 'c@x',
      GIT_AUTHOR_DATE: `${T + 900} +0000`,
      GIT_COMMITTER_DATE: `${T + 900} +0000`,
    }
  );

  return { dir, parsed: await parseRepo(dir) };
}

test('metrics: full-commit-set file and directory metrics', async () => {
  const { parsed } = await makeFixture();
  const root = computeMetrics(parsed, {});

  // |H| = 8 non-merge commits (c1-c8); merge commit excluded.
  assert.equal(root.set.total, 8);

  // Root: a=3+2+1+2+1+5=14, d=1+3+1=5, mods: c1,c2,c3,c4,c5,c7,c8 = 7
  assert.equal(root.added, 14);
  assert.equal(root.removed, 5);
  assert.equal(root.growth, 9);
  assert.equal(root.churn, 19);
  assert.equal(root.modifications, 7);
  assert.equal(root.modFrequency, 7 / 8);
  assert.equal(root.churnRate, 19 / 8);

  const child = (name) => root.children.find((c) => c.name === name);
  // Binary file must be entirely absent.
  assert.equal(child('logo.png'), undefined);

  const readme = child('README.md');
  assert.equal(readme.added, 4); // c1 +3, c3 +1
  assert.equal(readme.removed, 4); // c3 -1, c5 -3
  assert.equal(readme.growth, 0);
  assert.equal(readme.churn, 8);
  assert.equal(readme.modifications, 3);
  assert.equal(readme.type, 'file');

  const doc = child('doc.txt');
  assert.equal(doc.added, 5);
  assert.equal(doc.churn, 5);
  assert.equal(doc.modifications, 1);

  // src/ directory: only src/app.js contributed (4 added); src/main.js is 0/0.
  const src = computeMetrics(parsed, { path: 'src' });
  assert.equal(src.type, 'dir');
  assert.equal(src.added, 4);
  assert.equal(src.removed, 0);
  assert.equal(src.churn, 4);
  assert.equal(src.modifications, 2); // c2 and c4
  const appJs = src.children.find((c) => c.name === 'app.js');
  assert.equal(appJs.added, 4); // c2 +2, c4 +2
  assert.equal(appJs.removed, 0);
  const mainJs = src.children.find((c) => c.name === 'main.js');
  assert.equal(mainJs.churn, 0); // pure rename: no metric change
  assert.equal(mainJs.modifications, 0);

  // Rename-with-edit attributes to the NEW path only: lib/main.js +1/-1.
  const lib = computeMetrics(parsed, { path: 'lib' });
  assert.equal(lib.added, 1);
  assert.equal(lib.removed, 1);
  assert.equal(lib.churn, 2);
  assert.equal(lib.modifications, 1);

  // Deletion recorded on the deleted path (README.md) — covered above via c5.
});

test('metrics: H_t and H_{i,j} commit sets use committer date', async () => {
  const { parsed } = await makeFixture();

  // H_t: since T+350 -> c4..c8 (5 commits).
  const ht = computeMetrics(parsed, { since: T + 350 });
  assert.equal(ht.set.total, 5);
  assert.equal(ht.added, 8); // c4 +2, c7 +1, c8 +5
  assert.equal(ht.removed, 4); // c5 -3, c7 -1
  assert.equal(ht.modifications, 4);
  assert.equal(ht.modFrequency, 4 / 5);
  assert.equal(ht.churnRate, 12 / 5);

  // H_{i,j}: [T+150, T+450) -> c2, c3, c4.
  const hij = computeMetrics(parsed, { since: T + 150, until: T + 450 });
  assert.equal(hij.set.total, 3);
  assert.equal(hij.added, 5); // 2 + 1 + 2
  assert.equal(hij.removed, 1);
  assert.equal(hij.modifications, 3);
  assert.equal(hij.churn, 6);

  // Until-only: date < T+450 -> c1..c4 (c1 included, no lower bound).
  const untilOnly = computeMetrics(parsed, { until: T + 450 });
  assert.equal(untilOnly.set.total, 4);
  assert.equal(untilOnly.added, 8); // 3 + 2 + 1 + 2
  assert.equal(untilOnly.modifications, 4);
});

test('metrics: explicit commit selection', async () => {
  const { parsed } = await makeFixture();
  const c1 = parsed.commits.find((h) => h.subject === 'c1');
  const c3 = parsed.commits.find((h) => h.subject === 'c3');

  const m = computeMetrics(parsed, { commits: new Set([c1.hash, c3.hash]) });
  assert.equal(m.set.total, 2);
  assert.equal(m.added, 4); // +3 +1
  assert.equal(m.removed, 1);
  assert.equal(m.churn, 5);
  assert.equal(m.modifications, 2);

  const readme = m.children.find((c) => c.name === 'README.md');
  assert.equal(readme.added, 4);
  assert.equal(readme.removed, 1);
  assert.equal(readme.modifications, 2);
});

test('metrics: author metrics, manual merge, and ownership', async () => {
  const { parsed } = await makeFixture();

  // Without merging: three distinct authors.
  const raw = computeMetrics(parsed, {});
  const byName = new Map(raw.byAuthor.map((a) => [a.author, a]));
  assert.equal(byName.size, 3);
  assert.equal(byName.get(ALICE).churn, 5); // c1 3 + c3 2
  assert.equal(byName.get(ALICE_WORK).churn, 2); // c4 2
  assert.equal(byName.get(BOB).churn, 12); // c2 2 + c5 3 + c7 2 + c8 5
  assert.equal(byName.get(BOB).modifications, 4);
  assert.ok(Math.abs(byName.get(BOB).ownership - 12 / 19) < 1e-12);

  // Manual merge of Alice identities.
  const authorMap = buildAuthorMap(parsed, [], [[ALICE, ALICE_WORK]]);
  const merged = computeMetrics(parsed, { authorMap });
  const mergedByName = new Map(merged.byAuthor.map((a) => [a.author, a]));
  assert.equal(mergedByName.size, 2);
  assert.equal(mergedByName.get(ALICE).churn, 7);
  assert.equal(mergedByName.get(ALICE).modifications, 3);
  assert.ok(Math.abs(mergedByName.get(ALICE).ownership - 7 / 19) < 1e-12);
  assert.ok(Math.abs(mergedByName.get(BOB).ownership - 12 / 19) < 1e-12);

  // Author filter: only Alice's commits contribute; |H| stays 8 per the brief.
  const aliceView = computeMetrics(parsed, { authorMap, author: ALICE });
  assert.equal(aliceView.set.total, 8);
  assert.equal(aliceView.added, 6); // c1 3 + c3 1 + c4 2
  assert.equal(aliceView.removed, 1);
  assert.equal(aliceView.churn, 7);
  assert.equal(aliceView.modifications, 3);
});

test('mailmap: parses git-mailmap formats and merges identities', async () => {
  const { parsed } = await makeFixture();
  const rules = parseMailmap(
    [
      '# comment line',
      'Alice <a@x> Alice Work <alice@work>', // specific: name+email -> canonical
      'Robert <b@x>', // email-only rule
    ].join('\n')
  );

  assert.equal(rules.length, 2);
  const authorMap = buildAuthorMap(parsed, rules, []);
  const root = computeMetrics(parsed, { authorMap });
  const byName = new Map(root.byAuthor.map((a) => [a.author, a]));

  // Alice Work merged into Alice via mailmap; Bob renamed via email-only rule.
  assert.equal(byName.size, 2);
  assert.equal(byName.get('Alice <a@x>').churn, 7);
  assert.equal(byName.get('Robert <b@x>').churn, 12);
  assert.equal(byName.get('Alice <a@x>').modifications, 3);
});

test('metrics: timeline buckets by month', async () => {
  const { parsed } = await makeFixture();
  const root = computeMetrics(parsed, {});
  // All fixture commits fall in the same month (2023-11).
  assert.equal(root.timeline.length, 1);
  assert.equal(root.timeline[0].month, '2023-11');
  assert.equal(root.timeline[0].added, 14);
  assert.equal(root.timeline[0].removed, 5);
});

test('metrics: parser handles the fixture deterministically', async () => {
  const { parsed } = await makeFixture();
  assert.equal(parsed.commits.length, 8);
  assert.ok(parsed.authors.includes(ALICE));
  assert.ok(parsed.authors.includes(ALICE_WORK));
  assert.ok(parsed.authors.includes(BOB));
  assert.ok(!parsed.paths.some((p) => p === 'logo.png'), 'binary file skipped');
  const subjects = parsed.commits.map((h) => h.subject);
  assert.deepEqual(subjects, ['merge feat', 'c8', 'c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1'].slice(1));
});
