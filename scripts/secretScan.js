// Findings include locations/categories only, never matched credential values.
export function secretFindings(source, { forbiddenValues = [] } = {}) {
  const patterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['provider-secret', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-proj-[A-Za-z0-9_-]{30,}|sb_secret_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})/g],
    ['aws-key', /(?:AKIA|ASIA)[A-Z0-9]{16}/g],
    ['credential-uri', /(?:mongodb(?:\+srv)?|postgres(?:ql)?):\/\/[^\s/:"'`]+:[^\s/@"'`]+@[^\s"'`]+/g],
    ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g]
  ];
  const findings = [];
  for (const [kind, pattern] of patterns) {
    for (const match of source.matchAll(pattern)) {
      // These are explicitly labelled template placeholders, not credentials.
      if (kind === 'credential-uri' && /(?:USERNAME:PASSWORD|<[^>]+>)@/.test(match[0])) continue;
      if (kind === 'jwt') {
        try {
          if (JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString()).role === 'anon') continue;
        } catch { /* Malformed JWT-shaped literals are still flagged. */ }
      }
      findings.push({ kind, line: source.slice(0, match.index).split('\n').length });
    }
  }
  if (forbiddenValues.some(value => typeof value === 'string' && value.length >= 12 && source.includes(value))) {
    findings.push({ kind: 'backend-secret-value', line: null });
  }
  return findings;
}
