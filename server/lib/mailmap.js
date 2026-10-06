// .mailmap support. Rules map a commit identity (name + email, or just the
// email) to a canonical "Proper Name <proper@email>" identity.
//
// Formats per git-mailmap(5):
//   Proper Name <proper@email>
//   <proper@email>
//   Proper Name <proper@email> <commit@email>
//   Proper Name <proper@email> Commit Name <commit@email>

const LINE =
  /^\s*(?:([^\n<>]*?)\s*)?<([^<>]*)>\s*(?:(?:([^\n<>]*?)\s*)?<([^<>]*)>)?\s*$/;

export function parseMailmap(text) {
  const rules = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    if (m[4] !== undefined) {
      // Proper Name <proper@email> Commit Name <commit@email>
      rules.push({
        properName: m[1] || '',
        properEmail: m[2] || '',
        commitName: m[3] || null,
        commitEmail: m[4],
      });
    } else {
      // "Proper Name <email>" / "<email>": rewrites every commit made with
      // that email (the single address is the commit key, not just the target).
      rules.push({
        properName: m[1] || '',
        properEmail: m[2] || '',
        commitName: null,
        commitEmail: m[2],
      });
    }
  }
  // Specific rules (name + email) take precedence over email-only rules.
  return rules.sort((a, b) => (a.commitName ? 0 : 1) - (b.commitName ? 0 : 1));
}

export function applyMailmap(identity, rules) {
  const m = /^(.*)<(.*)>$/.exec(identity.trim());
  if (!m) return identity;
  const name = m[1].trim();
  const email = m[2].trim();
  const emailLower = email.toLowerCase();
  for (const rule of rules) {
    if (rule.commitEmail == null) continue;
    if (rule.commitEmail.toLowerCase() !== emailLower) continue;
    if (rule.commitName && rule.commitName !== name) continue;
    return `${rule.properName || name} <${rule.properEmail || email}>`;
  }
  return identity;
}

// Build a raw author id -> canonical identity mapping from mailmap rules plus
// manual merge groups (arrays of raw identity strings). Merging happens at
// query time so it is reversible and never requires a re-parse.
export function buildAuthorMap(parsed, mailmapRules, mergeGroups = []) {
  const canon = parsed.authors.map((identity) => applyMailmap(identity, mailmapRules));

  // Union-find over author indices for manual merge groups.
  const parent = canon.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const indexOf = new Map(parsed.authors.map((a, i) => [a, i]));
  for (const group of mergeGroups || []) {
    const ids = (Array.isArray(group) ? group : [])
      .map((identity) => indexOf.get(identity))
      .filter((i) => i !== undefined);
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  const resolved = new Map(); // root index -> canonical string
  return parsed.authors.map((_, i) => {
    const root = find(i);
    if (!resolved.has(root)) resolved.set(root, canon[root]);
    return resolved.get(root);
  });
}
