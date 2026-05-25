const SENSITIVE_PATTERN = /(password|passcode|secret|token|api[-_ ]?key|card|credit|cvv|cvc|ssn|social|otp|2fa|mfa)/i;

export function isSensitiveField(input: {
  type?: string | null;
  autocomplete?: string | null;
  name?: string | null;
  id?: string | null;
  placeholder?: string | null;
  ariaLabel?: string | null;
}) {
  if (input.type?.toLowerCase() === "password") {
    return true;
  }
  const combined = [input.autocomplete, input.name, input.id, input.placeholder, input.ariaLabel].filter(Boolean).join(" ");
  return SENSITIVE_PATTERN.test(combined);
}

export function sanitizeValue(value: string | undefined, sensitive: boolean, type?: string | null) {
  if (type?.toLowerCase() === "password") {
    return undefined;
  }
  if (!value) {
    return value;
  }
  return sensitive ? "[MASKED]" : value;
}

export function runtimeVariableName(actionTitle: string, stepNumber: number) {
  const slug = actionTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return `${slug || "step"}_${stepNumber}`;
}
