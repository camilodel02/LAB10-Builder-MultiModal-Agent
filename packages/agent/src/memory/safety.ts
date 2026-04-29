const SECRET_PATTERNS: RegExp[] = [
  /(sb_secret_[A-Za-z0-9\-_]+)/g,
  /(sb_publishable_[A-Za-z0-9\-_]+)/g,
  /(sk-or-v1-[A-Za-z0-9]+)/g,
  /((?:AKIA|AIza)[A-Za-z0-9_\-]{8,})/g,
  /(ghp_[A-Za-z0-9]{20,})/g,
  /((?:xoxb|xoxp)-[A-Za-z0-9-]+)/g,
  /(Bearer\s+[A-Za-z0-9\-_.=]+)/gi,
  /("?(?:token|secret|password|api_key|apikey)"?\s*[:=]\s*)"[^"]+"/gi,
];

export function redactSensitiveContent(input: string): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}
